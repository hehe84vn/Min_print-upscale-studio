const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { analyzeImage, MAX_SCALE, SAFE_OUTPUT_PIXELS, normalizeFixedScale, normalizeScale } = require('./smartAnalyzerService');
const { processImage } = require('./imageService');
const { createPreflightContext, runPackagingPreflight } = require('./preflightService');
const { convertToCmyk, normalizeSettings: normalizeColorSettings } = require('./colorOutputService');

function sanitizeName(value) {
  return String(value || 'image')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'image';
}

function sessionStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeBatchSettings(value = {}) {
  const outputMode = value.outputMode === 'target-print' ? 'target-print' : 'fixed-scale';
  const format = ['png', 'tiff'].includes(value.format) ? value.format : 'png';
  const fixedScale = normalizeFixedScale(value.fixedScale, 4);
  const targetPrint = {
    width: Number(value.targetPrint?.width) || null,
    height: Number(value.targetPrint?.height) || null,
    unit: ['mm', 'cm', 'in'].includes(value.targetPrint?.unit) ? value.targetPrint.unit : 'cm',
    dpi: [150, 200, 240, 300].includes(Number(value.targetPrint?.dpi)) ? Number(value.targetPrint.dpi) : 300
  };
  return {
    outputMode,
    fixedScale,
    targetPrint,
    format,
    dpi: [150, 200, 240, 300].includes(Number(value.dpi)) ? Number(value.dpi) : 300,
    autoRecommendModel: value.autoRecommendModel !== false,
    fallbackModel: typeof value.fallbackModel === 'string' && value.fallbackModel ? value.fallbackModel : 'high-fidelity-4x',
    cmykEnabled: Boolean(value.cmykEnabled),
    colorOutputSettings: normalizeColorSettings({ ...(value.colorOutputSettings || {}), outputMode: 'rgb-cmyk' }),
    qualityCheckEnabled: value.qualityCheckEnabled !== false,
    stopOnRisk: Boolean(value.stopOnRisk),
    maxOutputPixels: Math.min(SAFE_OUTPUT_PIXELS, Math.max(50_000_000, Number(value.maxOutputPixels) || SAFE_OUTPUT_PIXELS))
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function outputExtension(format) {
  return format === 'tiff' ? '.tif' : '.png';
}

async function summarizeFile(filePath) {
  const [metadata, stat] = await Promise.all([
    sharp(filePath, { failOn: 'none' }).metadata(),
    fs.stat(filePath)
  ]);
  return {
    width: metadata.width || null,
    height: metadata.height || null,
    format: metadata.format || path.extname(filePath).slice(1),
    colorSpace: metadata.space || 'unknown',
    channels: metadata.channels || null,
    density: metadata.density || null,
    sizeBytes: stat.size
  };
}

class ProductionQueue {
  constructor({ settingsService, secureSecretsService = null, onStatus = null } = {}) {
    this.settingsService = settingsService;
    this.secureSecretsService = secureSecretsService;
    this.onStatus = onStatus;
    this.state = this.emptyState();
    this.runPromise = null;
  }

  emptyState() {
    return {
      id: null,
      status: 'idle',
      outputDirectory: null,
      reportPath: null,
      settings: null,
      createdAt: null,
      startedAt: null,
      completedAt: null,
      pauseRequested: false,
      currentJobId: null,
      progress: 0,
      message: '',
      jobs: []
    };
  }

  emit(message = null) {
    if (message) this.state.message = message;
    this.onStatus?.(this.getStatus());
  }

  getStatus() {
    const jobs = this.state.jobs || [];
    const counts = {
      total: jobs.length,
      queued: jobs.filter((job) => job.status === 'queued').length,
      analyzing: jobs.filter((job) => job.status === 'analyzing').length,
      processing: jobs.filter((job) => job.status === 'processing').length,
      completed: jobs.filter((job) => job.status === 'completed').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
      review: jobs.filter((job) => job.qualityCheck?.status === 'warning').length,
      risk: jobs.filter((job) => job.qualityCheck?.status === 'fail').length
    };
    return clone({ ...this.state, counts });
  }

  async start({ inputs = [], outputDirectory, settings = {} }) {
    if (['running', 'pausing'].includes(this.state.status)) throw new Error('Batch đang chạy. Hãy pause hoặc đợi hoàn tất.');
    const uniqueInputs = [...new Set(inputs.filter(Boolean))];
    if (!uniqueInputs.length) throw new Error('Chưa chọn ảnh cho Batch Production.');
    if (!outputDirectory) throw new Error('Chưa chọn thư mục lưu Batch Production.');

    const normalized = normalizeBatchSettings(settings);
    const batchDirectory = path.join(outputDirectory, `Print-Upscale-Batch-${sessionStamp()}`);
    await fs.mkdir(batchDirectory, { recursive: true });

    this.state = {
      id: `batch-${Date.now()}`,
      status: 'running',
      outputDirectory: batchDirectory,
      reportPath: path.join(batchDirectory, 'production-report.json'),
      settings: normalized,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
      pauseRequested: false,
      currentJobId: null,
      progress: 0,
      message: 'Đang chuẩn bị batch',
      jobs: uniqueInputs.map((inputPath, index) => ({
        id: `job-${index + 1}`,
        order: index + 1,
        inputPath,
        fileName: path.basename(inputPath),
        status: 'queued',
        progress: 0,
        message: 'Chờ xử lý',
        analysis: null,
        outputPath: null,
        cmykOutput: null,
        qualityCheck: null,
        metadata: null,
        durationMs: null,
        error: null
      }))
    };
    await this.writeReport();
    this.emit('Batch Production đã bắt đầu');
    this.runPromise = this.runLoop();
    return this.getStatus();
  }

  pause() {
    if (this.state.status !== 'running') return this.getStatus();
    this.state.pauseRequested = true;
    this.state.status = 'pausing';
    this.emit('Sẽ tạm dừng sau job hiện tại');
    return this.getStatus();
  }

  resume() {
    if (!['paused', 'completed-with-errors', 'completed'].includes(this.state.status)) return this.getStatus();
    if (!this.state.jobs.some((job) => job.status === 'queued')) return this.getStatus();
    this.state.pauseRequested = false;
    this.state.status = 'running';
    this.state.completedAt = null;
    this.emit('Tiếp tục Batch Production');
    this.runPromise = this.runLoop();
    return this.getStatus();
  }

  retryFailed() {
    if (['running', 'pausing'].includes(this.state.status)) throw new Error('Không thể retry khi batch đang chạy.');
    let reset = 0;
    for (const job of this.state.jobs) {
      if (job.status === 'failed') {
        job.status = 'queued';
        job.progress = 0;
        job.message = 'Chờ retry';
        job.error = null;
        job.outputPath = null;
        job.cmykOutput = null;
        job.qualityCheck = null;
        job.metadata = null;
        reset += 1;
      }
    }
    if (!reset) return this.getStatus();
    this.state.pauseRequested = false;
    this.state.status = 'running';
    this.state.completedAt = null;
    this.emit(`Đang retry ${reset} job lỗi`);
    this.runPromise = this.runLoop();
    return this.getStatus();
  }

  async runLoop() {
    try {
      while (true) {
        if (this.state.pauseRequested) {
          this.state.status = 'paused';
          this.state.currentJobId = null;
          this.emit('Batch đã tạm dừng');
          await this.writeReport();
          return;
        }
        const job = this.state.jobs.find((entry) => entry.status === 'queued');
        if (!job) break;
        await this.processJob(job);
        await this.writeReport();
      }

      const failed = this.state.jobs.some((job) => job.status === 'failed');
      this.state.status = failed ? 'completed-with-errors' : 'completed';
      this.state.currentJobId = null;
      this.state.progress = 100;
      this.state.completedAt = new Date().toISOString();
      this.emit(failed ? 'Batch hoàn tất nhưng có job lỗi' : 'Batch Production hoàn tất');
      await this.writeReport();
    } catch (error) {
      this.state.status = 'completed-with-errors';
      this.state.currentJobId = null;
      this.state.message = error.message || String(error);
      this.state.completedAt = new Date().toISOString();
      this.emit();
      await this.writeReport();
    }
  }

  async processJob(job) {
    const startedAt = Date.now();
    const settings = this.state.settings;
    this.state.currentJobId = job.id;
    job.status = 'analyzing';
    job.message = 'Smart Analyzer đang phân tích';
    job.progress = 2;
    this.emit(`${job.fileName}: đang phân tích`);

    try {
      const analysisOptions = {
        scale: settings.fixedScale,
        format: settings.format,
        cmyk: settings.cmykEnabled
      };
      if (settings.outputMode === 'target-print') analysisOptions.targetPrint = settings.targetPrint;
      job.analysis = await analyzeImage(job.inputPath, analysisOptions);

      if (job.analysis.targetPlan?.exceedsScaleLimit) {
        throw new Error('Kích thước in yêu cầu vượt giới hạn cứng 8×. Hãy giảm DPI, giảm khổ in hoặc dùng ảnh nguồn lớn hơn.');
      }
      if (job.analysis.output.pixels > settings.maxOutputPixels) {
        throw new Error(`Ảnh đầu ra ${job.analysis.output.megapixels} MP vượt ngưỡng an toàn ${(settings.maxOutputPixels / 1_000_000).toFixed(0)} MP.`);
      }

      const scale = normalizeScale(
        settings.outputMode === 'target-print'
          ? job.analysis.targetPlan?.appliedScale
          : settings.fixedScale,
        settings.fixedScale
      );
      if (scale > MAX_SCALE) throw new Error('Scale vượt giới hạn cứng 8×.');
      const model = settings.autoRecommendModel
        ? job.analysis.recommendation.model
        : settings.fallbackModel;
      const parsed = path.parse(job.inputPath);
      const outputPath = path.join(
        this.state.outputDirectory,
        `${String(job.order).padStart(3, '0')}_${sanitizeName(parsed.name)}_${Number(scale.toFixed(2))}x${outputExtension(settings.format)}`
      );

      job.status = 'processing';
      job.message = `${model} · ${Number(scale.toFixed(2))}×`;
      job.progress = 8;
      this.emit(`${job.fileName}: ${job.message}`);

      const qualityContext = settings.qualityCheckEnabled
        ? await createPreflightContext(job.inputPath)
        : null;

      await processImage({
        operation: 'upscale',
        inputPath: job.inputPath,
        outputPath,
        options: {
          scale,
          model,
          useNcnn: true,
          allowFallback: true,
          sharpen: true,
          dpi: settings.dpi,
          quality: 95
        },
        settingsService: this.settingsService,
        secureSecretsService: this.secureSecretsService,
        onProgress: (percent, message) => {
          job.progress = Math.max(8, Math.min(86, Math.round(8 + (Number(percent) || 0) * 0.78)));
          job.message = message || 'Đang upscale';
          this.state.progress = this.overallProgress(job.progress);
          this.emit(`${job.fileName}: ${job.message}`);
        }
      });

      job.outputPath = outputPath;
      job.metadata = await summarizeFile(outputPath);
      job.progress = 88;

      if (qualityContext) {
        job.message = 'Đang chạy Upscale Quality Check';
        this.emit(`${job.fileName}: ${job.message}`);
        try {
          job.qualityCheck = await runPackagingPreflight({
            context: qualityContext,
            outputPath,
            semanticMaskPath: null,
            protection: null
          });
        } catch (error) {
          job.qualityCheck = {
            status: 'warning',
            score: null,
            error: error.message || String(error),
            metrics: {},
            recommendations: ['Quality Check lỗi kỹ thuật; cần kiểm tra thủ công.']
          };
        }
      }

      if (settings.stopOnRisk && job.qualityCheck?.status === 'fail') {
        throw new Error('Quality Check đánh dấu RISK và chế độ Stop on Risk đang bật.');
      }

      if (settings.cmykEnabled) {
        job.progress = 94;
        job.message = 'Đang tạo CMYK TIFF copy';
        this.emit(`${job.fileName}: ${job.message}`);
        job.cmykOutput = await convertToCmyk({
          inputPath: outputPath,
          dpi: settings.dpi,
          settings: settings.colorOutputSettings
        });
      }

      job.status = 'completed';
      job.progress = 100;
      job.message = 'Hoàn tất';
      job.durationMs = Date.now() - startedAt;
      this.state.progress = this.overallProgress(100);
      this.emit(`${job.fileName}: hoàn tất`);
    } catch (error) {
      job.status = 'failed';
      job.progress = 100;
      job.message = 'Lỗi';
      job.durationMs = Date.now() - startedAt;
      job.error = error.message || String(error);
      this.state.progress = this.overallProgress(100);
      this.emit(`${job.fileName}: ${job.error}`);
    }
  }

  overallProgress(currentJobProgress = 0) {
    const total = Math.max(1, this.state.jobs.length);
    const completed = this.state.jobs.filter((job) => ['completed', 'failed'].includes(job.status)).length;
    return Math.min(100, Math.round(((completed + currentJobProgress / 100) / total) * 100));
  }

  async writeReport() {
    if (!this.state.reportPath) return;
    const report = {
      schemaVersion: 1,
      createdAt: this.state.createdAt,
      updatedAt: new Date().toISOString(),
      status: this.state.status,
      outputDirectory: this.state.outputDirectory,
      settings: this.state.settings,
      counts: this.getStatus().counts,
      jobs: this.state.jobs
    };
    await fs.writeFile(this.state.reportPath, JSON.stringify(report, null, 2), 'utf8');
  }
}

module.exports = {
  ProductionQueue,
  normalizeBatchSettings,
  sanitizeName
};