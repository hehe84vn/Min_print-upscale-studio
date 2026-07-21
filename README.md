# Print Upscale Studio V2

Ứng dụng desktop hybrid dành cho workflow hình ảnh và in ấn:

- **Local Enhance**: tăng kích thước bằng bộ xử lý AI cục bộ, không gửi ảnh ra ngoài và không tốn phí API.
- **AI Enhance**: gửi ảnh tới Gemini hoặc OpenAI để tái tạo chi tiết theo ba mức Safe, Balanced và Creative.
- **Restore Safe**: khử nhiễu, phục hồi tương phản/màu và làm nét có kiểm soát.
- **Text & Artwork**: tăng độ nét chữ raster mà không OCR, không thay font và không sửa nội dung.
- **Vector Logo**: chuyển logo màu, logo một màu, con dấu hoặc line art sang SVG bằng VTracer.
- **Before/After**: so sánh ảnh nguồn và ảnh đầu ra bằng thanh kéo.
- **Print Inspector**: hiển thị kích thước pixel, dung lượng, hệ màu và kích thước in tham khảo ở 300 DPI.

Đây là code clean-room mới hoàn toàn. Dự án không chứa code, license key hoặc tài sản của FD Advertising.

## Trạng thái bản 2.0.0

- Windows 10/11 x64.
- macOS 12 trở lên, build riêng Intel x64 và Apple Silicon arm64.
- Nhúng sẵn runtime Local AI và bảy model.
- Gemini dùng `gemini-3.1-flash-image` hoặc `gemini-3-pro-image`.
- OpenAI dùng `gpt-image-2` qua Images Edit API.
- API key do người dùng tự nhập và được mã hóa bằng Electron `safeStorage` của hệ điều hành.
- API key không lưu trong `settings.json`, không gửi về renderer và không commit lên GitHub.
- AI Cloud cần Internet và phát sinh phí trực tiếp trên tài khoản API của người dùng.

## Cấu hình AI Cloud

Trong ứng dụng, mở **Cài đặt → AI Provider & API key**:

1. Chọn Gemini hoặc OpenAI làm provider mặc định.
2. Nhập API key tương ứng.
3. Bấm **Lưu cài đặt**.
4. Bấm **Kiểm tra** để xác nhận key và kết nối.
5. Mở **AI Enhance**, chọn provider, model và mức tái tạo.

### Gemini

- Nano Banana 2: `gemini-3.1-flash-image`.
- Nano Banana Pro: `gemini-3-pro-image`.
- V2 yêu cầu đầu ra 2K hoặc 4K bằng Gemini Interactions API.

### OpenAI

- Model: `gpt-image-2`.
- Dùng chế độ image edit với input fidelity cao.
- Kích thước đầu ra để API tự lựa chọn theo ảnh nguồn.

## Các mức AI Enhance

- **Safe**: ưu tiên giữ nhận dạng, bố cục, màu, chữ và logo sát ảnh gốc.
- **Balanced**: tái tạo texture vừa phải, phù hợp ảnh quảng cáo và ảnh chụp thông thường.
- **Creative**: tái dựng mạnh hơn, có nguy cơ thay đổi chi tiết nhỏ.

AI tạo sinh không bảo đảm giữ chính xác tuyệt đối chữ, logo, barcode, màu in hoặc khuôn mặt. Luôn kiểm tra Before/After trước khi dùng cho artwork chính thức.

## Chạy ở chế độ phát triển

Yêu cầu Node.js 22 trở lên.

```bash
npm install
npm start
```

Kiểm tra cú pháp và chạy smoke test cho các pipeline local:

```bash
npm run check
```

Smoke test không gọi Gemini hoặc OpenAI và không phát sinh phí API.

## Local AI Engine

Runtime được nhúng trong installer all-in-one. Người dùng thông thường chỉ thấy trạng thái **Local AI Engine: Sẵn sàng**.

Khi cần xử lý sự cố, mở:

**Cài đặt → Cấu hình Local Engine nâng cao**

Các model hỗ trợ:

- `upscayl-standard-4x`
- `upscayl-lite-4x`
- `high-fidelity-4x`
- `remacri-4x`
- `ultramix-balanced-4x`
- `ultrasharp-4x`
- `digital-art-4x`

## Build file cài đặt

### Windows

```bash
npm install
npm run dist:win
```

Kết quả trong `release/`:

- NSIS installer `.exe`
- Portable `.exe`

### macOS

```bash
npm install
npm run dist:mac:arm64
# hoặc trên Mac Intel
npm run dist:mac:x64
```

Kết quả trong `release/`:

- `.dmg`
- `.zip`

## GitHub Actions

Workflow `.github/workflows/build-desktop.yml`:

- kiểm tra cú pháp và smoke test trên Ubuntu;
- build Windows x64;
- build macOS Apple Silicon và Intel;
- upload installer vào **Actions → Artifacts**;
- khi push tag `v*`, tự tạo GitHub Release.

## Chưa ký số

Workflow mặc định xuất file unsigned:

- Windows có thể hiện SmartScreen “Unknown publisher”.
- macOS có thể chặn Gatekeeper.

Để phân phối ổn định, cần Windows code-signing certificate và Apple Developer ID/notarization.

## License

Code ứng dụng: MIT. Xem `THIRD_PARTY_NOTICES.md` trước khi phân phối, đặc biệt với runtime Local AI và từng model weight.
