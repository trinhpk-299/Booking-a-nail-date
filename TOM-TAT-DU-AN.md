# TÓM TẮT DỰ ÁN — Glam Nails Sunderland Booking Website

## 1. Mục tiêu
Xây 1 website đặt lịch nail cho **Glam Nails Sunderland**, thay thế Calendly, miễn phí 100%, tự động ghi thông tin khách vào Google Sheet, gửi email xác nhận, và đồng bộ hai chiều với Google Calendar.

## 2. Kiến trúc hệ thống
- **Frontend**: 1 file `index.html` độc lập (HTML/CSS/JS thuần, không cần build) — deploy miễn phí qua GitHub Pages hoặc Netlify.
- **Backend**: Google Apps Script (`Code.gs`) gắn vào Google Sheet — đóng vai trò API, chạy hoàn toàn miễn phí trên hạ tầng Google.
- **Database**: chính Google Sheet (tab "Bookings") — không cần database riêng.
- **Email**: gửi qua Gmail (glamnails1409@gmail.com) bằng MailApp trong Apps Script.
- **Calendar**: tạo sự kiện + gửi lời mời tự động qua CalendarApp trong Apps Script.

## 3. Business rules đã cấu hình
| Thông tin | Giá trị |
|---|---|
| Địa điểm | Sunderland — 35 Melbourne Pl, Sunderland SR4 8LN, UK |
| SĐT | +44 7873 129148 |
| Giờ mở cửa | Thứ 2 – Thứ 7, 9h00 – 18h00, không nghỉ trưa |
| Độ dài mỗi khung giờ | 60 phút (9 khung/ngày) |
| Số chỗ tối đa/khung giờ | 5 |
| Chủ nhật | Đóng cửa, **trừ 23/8/2026** (ngày khai trương — mở đặc biệt) |
| Khuyến mãi | 50% OFF ngày 23/8/2026; 30% OFF từ 24/8 – 5/9/2026 |
| Thông tin khách thu thập | Họ tên, SĐT, Email (bắt buộc), Ghi chú (tùy chọn) — không có dropdown chọn dịch vụ |
| Ngôn ngữ giao diện | Tiếng Anh |
| Định dạng ngày hiển thị | MM/DD/YYYY |

## 4. Các tính năng đã hoàn thành
- [x] Giao diện đặt lịch responsive (đã test kỹ trên màn hình 320px–390px, không tràn ngang)
- [x] Theme đồng bộ brand "treated like royalty" — tông màu plum/gold, font Cormorant Garamond + Jost
- [x] Favicon dùng logo thật của Glam Nails (đã crop vuông, nhúng base64 trong file)
- [x] Chọn ngày → tự tính khung giờ trống theo business rules ở trên
- [x] Giới hạn 5 khách/khung giờ, khung đầy tự disable
- [x] Trang xác nhận (confirmation page) sau khi đặt — hiện đủ thông tin khách, kèm thông báo đã gửi email + đã lên Calendar
- [x] Backend Apps Script: ghi Sheet, gửi email xác nhận, tạo sự kiện Calendar (có gửi lời mời cho khách)
- [x] Chức năng `syncManualCalendarEntries()` — quét Calendar định kỳ (cần đặt Trigger 15 phút/lần), tự ghi lịch bạn thêm tay trên Calendar vào Sheet để không bị trùng chỗ

## 5. BƯỚC TIẾP THEO CẦN LÀM (checklist)
- [ ] **Deploy Apps Script**: dán `Code.gs` vào Google Sheet (Extensions > Apps Script) > Deploy > Web app > copy URL
- [ ] **Gắn URL vào `index.html`**: thay `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` bằng URL thật vừa copy
- [ ] **Deploy `index.html`** lên GitHub Pages hoặc Netlify (đã có sẵn cả 2 hướng dẫn trong `HUONG-DAN-SETUP.md`)
- [ ] **Đặt tên tab Sheet đúng là "Bookings"** — lỗi thường gặp nếu quên bước này (đã từng gặp lỗi `Cannot read properties of null (reading 'getLastRow')`)
- [ ] **Test toàn luồng**: đặt thử 1 lịch → kiểm tra Sheet có dòng mới, email có gửi tới, sự kiện có lên Calendar
- [ ] **(Tùy chọn) Đặt Trigger `syncManualCalendarEntries`** mỗi 15 phút nếu muốn lịch tự thêm tay trên Calendar cũng được đồng bộ ngược vào Sheet
- [ ] **(Tùy chọn) Rút gọn link**: đang cân nhắc giữa GitHub Pages (cần tạo GitHub Organization để bỏ chữ "trinhpk" khỏi URL) hoặc đổi tên site trên Netlify (dạng `<tên>.netlify.app`, miễn phí, không cần domain riêng)
- [ ] **(Tùy chọn, cần mua domain)** Nếu muốn link dạng `bookanaildate.tenmiengoc.com`, cần mua domain riêng trước rồi cấu hình DNS trỏ về GitHub Pages/Netlify

## 6. Các vấn đề đã gặp và đã fix
| Vấn đề | Nguyên nhân | Đã fix |
|---|---|---|
| Không chọn được giờ (lần 1) | JS gọi API chưa tồn tại, bị treo | Chuyển sang chế độ demo dùng mock data để test độc lập trước |
| Không chọn được giờ (lần 2) | Dùng `<div onclick>` — 1 số webview trong app chỉ nhận tap trên `<button>` thật | Đổi toàn bộ slot sang `<button>` thật + `addEventListener` |
| Lỗi `Cannot read properties of null (reading 'getLastRow')` | Tên tab Google Sheet không khớp `"Bookings"` | Đổi lại tên tab cho đúng |
| Icon tab trình duyệt là hình trái đất mặc định | Chưa có favicon | Thêm favicon dùng logo thật, nhúng base64 |

## 7. Danh sách file hiện có
- `Code.gs` — backend Apps Script (ghi Sheet, gửi email, tạo Calendar event, sync 2 chiều)
- `index.html` — trang đặt lịch hoàn chỉnh (đã nhúng sẵn favicon logo)
- `HUONG-DAN-SETUP.md` — hướng dẫn setup chi tiết từng bước, có cả phần troubleshoot
- `TOM-TAT-DU-AN.md` — chính là file này

## 8. Về việc dùng tài khoản Pro
Vì vẫn dùng chung email, **không cần thao tác gì để "chuyển"** — toàn bộ đoạn chat này, trí nhớ về dự án, và các file đều tự động còn nguyên khi bạn nâng cấp gói cước. Nếu muốn mình có thể thao tác trực tiếp hơn (tự đẩy code lên GitHub thay vì bạn tải về upload tay), có thể kết nối GitHub connector trong Settings > Connectors — không bắt buộc phải là Pro/Team mới dùng được.
