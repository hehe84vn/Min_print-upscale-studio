# Delivery Status Rule

Quy tắc này áp dụng cho mọi thay đổi của Print Upscale Studio.

## Không được dùng từ “đã xong” khi chưa đủ bằng chứng

Chỉ được báo **Đã hoàn thành** khi đồng thời có đủ:

1. Code đã được commit lên đúng branch.
2. UI người dùng nhìn thấy đã được nối nếu yêu cầu có giao diện.
3. Luồng thao tác chính đã có smoke test hoặc kiểm tra tương đương.
4. Build/CI liên quan đã chạy thành công, hoặc phải ghi rõ là chưa chạy được.
5. Nếu là bản để người dùng cài: đã có artifact/bộ cài và đã cung cấp đúng cách truy cập.

Nếu thiếu bất kỳ mục nào, trạng thái phải ghi chính xác là một trong các mức sau:

- **Đã tạo nền tảng**: mới có service, API hoặc cấu trúc code.
- **Đã nối UI, chưa kiểm thử build**.
- **Đã kiểm thử code, chưa có bộ cài**.
- **Sẵn sàng để test**: có artifact/bộ cài và hướng dẫn test.
- **Đã phát hành**: đã đi qua luồng release chính thức.

## Báo cáo bắt buộc

Mỗi PR hoặc báo cáo tiến độ phải nêu rõ:

- Những gì đã có thật trong code.
- Những gì người dùng hiện nhìn thấy được.
- Những gì chưa làm.
- Kiểm thử nào đã chạy và kết quả.
- Có hay chưa có bộ cài/artifact.
- Có hay chưa phát hành qua Update Manager.

Không suy diễn trạng thái từ kế hoạch, mockup, tài liệu hoặc backend chưa nối UI.