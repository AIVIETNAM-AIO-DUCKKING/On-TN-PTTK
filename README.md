# Mini Quiz PTTKHT

Website luyện tập trắc nghiệm môn **Phân tích và Thiết kế Hệ thống Thông tin**.
Chỉ dùng HTML, CSS và JavaScript thuần — không cần backend, đăng nhập hay bước build. Triển khai miễn phí được trên GitHub Pages.

## Tính năng

- Mỗi lượt làm bài dùng **toàn bộ** câu hỏi hợp lệ trong `questions.json` (không chọn số câu).
- Xáo trộn thứ tự câu hỏi (Fisher–Yates) và **vị trí các phương án** ở mỗi lượt. Đáp án đúng được xác định bằng khóa gốc của phương án, không phụ thuộc vị trí hiển thị.
- LocalStorage chỉ dùng để nhớ thứ tự phương án gần nhất của từng câu, giúp lượt sau ưu tiên sắp xếp khác lượt trước. Xóa dữ liệu trình duyệt thì ứng dụng vẫn chạy bình thường.
- Điều hướng tự do giữa các câu bằng lưới số; câu đã trả lời, chưa trả lời và đang xem có trạng thái khác nhau. Có nút "Bỏ chọn câu này".
- Thanh tiến độ "Đã trả lời: X/N câu".
- Hộp thoại xác nhận nộp bài (tổng số câu, đã trả lời, chưa trả lời).
- Chấm điểm thang 10 (làm tròn 2 chữ số), bảng kết quả chi tiết, lọc theo Đúng / Sai / Chưa trả lời.
- **Luyện lại câu sai**: mỗi lượt chỉ gồm câu sai hoặc chưa trả lời của lượt ngay trước, lặp lại được nhiều lần. Khi đúng hết sẽ hiện lời chúc mừng.
- **Làm lại toàn bộ đề** bất cứ lúc nào sau khi nộp bài.
- Không lưu lịch sử điểm hay tài khoản.

## Cấu trúc thư mục

```
mini-quiz/
├── index.html
├── style.css
├── script.js
├── questions.json   # ngân hàng câu hỏi
├── README.md
└── .nojekyll
```

## Định dạng `questions.json`

Ứng dụng đọc được cả hai dạng phương án:

```json
[
  { "id": 1, "cau_hoi": "Nội dung câu hỏi", "options": ["A. Phương án A", "B. Phương án B", "C. Phương án C", "D. Phương án D"], "dap_an_dung": "B" },
  { "id": 2, "cau_hoi": "Nội dung câu hỏi", "options": { "A": "Phương án A", "B": "Phương án B" }, "dap_an_dung": "A" }
]
```

Quy tắc kiểm tra: mỗi câu cần `id` duy nhất, `cau_hoi` không rỗng, ít nhất 2 phương án có nội dung, và `dap_an_dung` khớp một phương án có nội dung. Câu không hợp lệ bị bỏ qua và được liệt kê ở màn hình đầu. Phương án rỗng (ví dụ `"C. "`) không được hiển thị.

## Chạy thử trên máy

Trình duyệt chặn `fetch` khi mở file trực tiếp (`file://`), nên cần một máy chủ cục bộ:

```bash
cd mini-quiz
python -m http.server 8000
# mở http://localhost:8000
```

## Triển khai lên GitHub Pages

1. Tạo repository mới trên GitHub (ví dụ `mini-quiz`), để chế độ Public.
2. Đưa toàn bộ file trong thư mục này lên nhánh `main` (kéo thả bằng giao diện web, hoặc dùng git):
   ```bash
   cd mini-quiz
   git init
   git add .
   git commit -m "Mini Quiz PTTKHT"
   git branch -M main
   git remote add origin https://github.com/<ten-ban>/mini-quiz.git
   git push -u origin main
   ```
3. Vào **Settings → Pages**. Ở mục **Build and deployment**, chọn **Source: Deploy from a branch**, **Branch: `main`**, thư mục **`/ (root)`**, rồi nhấn **Save**.
4. Đợi khoảng 1–2 phút, trang sẽ có địa chỉ `https://<ten-ban>.github.io/mini-quiz/`.

Muốn cập nhật câu hỏi: sửa `questions.json`, commit và push lại. Nếu trình duyệt còn hiện dữ liệu cũ, tải lại bằng Ctrl+F5.
