# Vector Golden Benchmark V11

Mỗi sample có một thư mục riêng trong `samples/`:

- `input.png`: ảnh raster dùng để trace lại khi cập nhật candidate.
- `golden.svg`: SVG chuẩn đã được designer kiểm tra trong Illustrator.
- `candidate.svg`: SVG sinh bởi phiên bản app đang benchmark.
- `notes.md`: các vùng cần quan sát như dấu tiếng Việt, vòng tròn, nét mảnh hoặc góc vuông.

Khai báo sample trong `manifest.json`, sau đó chạy:

```bash
npm run benchmark:vector
```

Kết quả được ghi vào `benchmark-results/vector-golden/` gồm `summary.json`, `summary.csv` và `report.html`.

Benchmark fail khi vượt threshold tuyệt đối hoặc giảm đáng kể so với `baseline.json`. Không dùng ảnh/logo thương hiệu bên thứ ba nếu chưa có quyền lưu trong repository.
