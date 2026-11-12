# Hướng dẫn setup — Glam Nails Sunderland Booking

## Bước 1: Tạo Google Sheet
1. Vào Google Sheets (dùng tài khoản **glamnails1409@gmail.com**), tạo sheet mới.
2. Đổi tên tab (sheet) ở dưới cùng thành đúng chữ **`Bookings`** (viết hoa chữ B, không dấu cách thừa).

## Bước 2: Gắn Apps Script
1. Trong Google Sheet, vào menu **Extensions > Apps Script**.
2. Xóa hết code mẫu, dán toàn bộ nội dung file `Code.gs` vào.
3. Bấm **Save** (biểu tượng đĩa mềm).

## Bước 3: Deploy thành Web App
1. Bấm nút **Deploy > New deployment**.
2. Ở mục "Select type", chọn **Web app**.
3. Cấu hình:
   - Execute as: **Me (glamnails1409@gmail.com)**
   - Who has access: **Anyone**
4. Bấm **Deploy**. Lần đầu Google sẽ yêu cầu cấp quyền (Authorize access) — chọn tài khoản glamnails1409@gmail.com và bấm "Allow" dù có cảnh báo "unsafe" (bình thường vì đây là script tự viết).
   - Script này xin quyền vào **Sheet**, **Gmail** (gửi mail), và **Calendar** (tạo lịch hẹn) — cả 3 quyền đều cần đồng ý.
5. Copy **Web app URL** hiện ra (dạng `https://script.google.com/macros/s/xxxxx/exec`).
   > 💡 Nếu bạn lỡ tắt màn hình này mà chưa kịp copy URL, không cần deploy lại — vào **Deploy > Manage deployments**, bấm vào bản deploy đã tạo, URL sẽ hiện lại kèm nút copy.

## Bước 4: Gắn URL vào trang web
1. Mở file `index.html`.
2. Tìm dòng:
   ```js
   const API_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```
3. Thay bằng URL vừa copy ở Bước 3. Khi URL thật được dán vào, dòng cảnh báo "Backend not connected yet" ở đầu trang sẽ tự động biến mất.
4. `USE_LIVE_BACKEND` đã được set sẵn là `true` — không cần đổi gì thêm.

## Bước 5: Deploy trang web (miễn phí)
Chọn 1 trong 2 cách:

**Cách A — Netlify (khuyên dùng, dễ nhất):**
1. Vào netlify.com, đăng ký free.
2. Kéo thả file `index.html` vào ô "Deploy manually".
3. Netlify cho bạn 1 link dạng `xxxx.netlify.app` — dùng link này gửi khách.

**Cách B — GitHub Pages:**
1. Tạo repo GitHub mới, upload `index.html`.
2. Vào Settings > Pages > bật Pages cho nhánh main.
3. Link sẽ có dạng `tenban.github.io/tenrepo`.

## Bước 6: Test thử toàn bộ luồng
1. Mở link web vừa deploy.
2. Chọn ngày **23/8/2026** (khai trương) — kiểm tra tag "50% OFF" hiện ra.
3. Chọn ngày trong khoảng **24/8 - 5/9** — kiểm tra tag "30% OFF" hiện ra.
4. Chọn 1 khung giờ, điền tên/SĐT/email test, bấm "Confirm Booking".
5. Kiểm tra:
   - Dòng mới xuất hiện trong Google Sheet tab "Bookings" (kèm cột Calendar Event ID).
   - Email xác nhận gửi tới địa chỉ bạn nhập, gửi từ glamnails1409@gmail.com.
   - Sự kiện xuất hiện trên **Google Calendar** của glamnails1409@gmail.com, đúng ngày/giờ, có tên khách + SĐT + ghi chú trong phần mô tả.
   - Khách (email test) nhận được **lời mời Calendar** riêng qua Gmail (do `sendInvites: true` trong code), có thể bấm "Yes" để tự thêm vào Calendar cá nhân của họ.
6. Đặt thử 5 lần cùng 1 khung giờ để test giới hạn — lần thứ 6 phải báo hết chỗ, nút tự disable.
7. Thử chọn 1 Chủ nhật khác (không phải 23/8) — phải báo đóng cửa.

## Bước 7 (Tùy chọn): Bật tự động đồng bộ lịch bạn thêm tay trên Calendar

Nếu bạn muốn: mỗi khi tự thêm lịch hẹn trực tiếp trên Google Calendar (khách gọi điện đặt, walk-in...), hệ thống **tự động ghi thêm dòng vào Sheet** để web trừ chỗ đúng — làm theo các bước sau:

1. Trong Apps Script, vào menu bên trái, bấm biểu tượng **đồng hồ (Triggers)**.
2. Bấm **+ Add Trigger** (góc dưới phải).
3. Cấu hình:
   - Choose which function to run: **`syncManualCalendarEntries`**
   - Choose which deployment should run: **Head**
   - Select event source: **Time-driven**
   - Select type of time based trigger: **Minutes timer**
   - Select minute interval: **Every 15 minutes**
4. Bấm **Save**. Lần đầu Google có thể yêu cầu cấp quyền lại — bấm Allow.

**Cách hoạt động:**
- Cứ 15 phút, script tự quét toàn bộ Calendar của salon (từ hôm qua tới 60 ngày tới).
- Lịch nào đã đặt qua web (đã có sẵn trong Sheet) → bỏ qua, không ghi trùng.
- Lịch nào bạn tự thêm tay trên Calendar → tự động thêm 1 dòng mới vào Sheet, cột "Notes" ghi "Synced from Google Calendar" để phân biệt.
- Khung giờ bạn thêm tay sẽ được tính vào giới hạn 5 chỗ/khung giờ như bình thường.

**Giới hạn cần biết:**
- Có độ trễ tối đa ~15 phút giữa lúc bạn thêm lịch trên Calendar và lúc web cập nhật — không phải tức thời.
- Vì Calendar không có sẵn ô "Phone number", cột Phone của các dòng sync tự động sẽ để trống. Nếu muốn lưu SĐT khách, bạn có thể gõ thêm vào phần **mô tả (description)** của sự kiện Calendar theo cú pháp riêng, nhưng cần chỉnh thêm code để đọc ra — nói mình biết nếu muốn làm phần này.
- Muốn test thử ngay không đợi 15 phút: vào Apps Script > chọn hàm `syncManualCalendarEntries` ở thanh trên cùng > bấm nút **Run** (▶) — chạy thủ công 1 lần ngay lập tức.

## Bước 8 (Tùy chọn nhưng nên làm): Giảm độ trễ lần đầu tải giờ trống

Lần đầu tiên gọi tới web app sau một thời gian không ai dùng, Google Apps Script cần "khởi động lại" (cold start), có thể mất 20-60 giây — đây là giới hạn của nền tảng Apps Script, không phải lỗi code. Để giảm việc này:

1. Trong Apps Script, vào **Triggers** (biểu tượng đồng hồ) > **+ Add Trigger**.
2. Cấu hình:
   - Choose which function to run: **`keepWarm`**
   - Select event source: **Time-driven**
   - Select type of time based trigger: **Minutes timer**
   - Select minute interval: **Every 10 minutes**
3. Bấm **Save**.

Việc này giúp script luôn ở trạng thái "ấm", nên hầu hết các lần khách vào web sẽ tải giờ trống trong 1-3 giây thay vì có thể phải chờ rất lâu ở lần gọi đầu tiên. Ngoài ra, code đã được tối ưu để cache kết quả 20 giây/ngày — bấm qua lại cùng 1 ngày sẽ trả về gần như ngay lập tức.

## Lưu ý quan trọng
- **Giới hạn Gmail gửi mail**: tài khoản Gmail thường (không phải Workspace) giới hạn ~100 email/ngày qua Apps Script. Với quy mô salon nhỏ thì thoải mái.
- **Giờ hoạt động & business rules hiện tại** — chỉnh trong `Code.gs`, đầu file, phần `CẤU HÌNH`:
  ```js
  const MAX_PER_SLOT = 3;                         // số chỗ mỗi khung giờ
  const HOURS_BY_DOW = { ... };                   // giờ mở cửa theo thứ (CN 10:00-16:30, T2-T7 10:00-18:00)
  const HOURS_OVERRIDES = [ ... ];                // giờ riêng cho ngày/khoảng ngày cụ thể (mùa lễ cuối năm 2026)
  const REDUCED_CAPACITY_FROM = "2026-12-20";     // từ ngày này mỗi khung chỉ nhận
  const REDUCED_MAX_PER_SLOT = 2;                 // 2 chỗ (không có ngày kết thúc)
  ```
  Salon mở tất cả các ngày. Ngày nghỉ cả ngày: thêm `{ from, to, closed: true }` vào `HOURS_OVERRIDES`, hoặc gõ ngày vào tab "Closed Dates" trong Sheet (không cần sửa code). Giờ mở cửa lẻ dùng số thập phân (8.5 = 08:30); khung giờ đầu tính từ giờ mở cửa, khung cuối tự rút ngắn cho vừa giờ đóng cửa.
- **Nếu đổi tên tab Sheet** khác "Bookings", nhớ sửa lại trong `Code.gs` dòng `getSheetByName("Bookings")`.
- **Đồng bộ Calendar**: script tạo sự kiện trên Calendar gắn với `glamnails1409@gmail.com`. Nếu muốn dùng Calendar khác (ví dụ Calendar riêng cho Sunderland), đổi `SALON_EMAIL` hoặc dùng ID Calendar cụ thể trong hàm `createCalendarEvent_()`.
- **Giờ mở cửa/số chỗ do server (`Code.gs`) quyết định**: web lấy danh sách khung giờ, trạng thái đầy/đã qua/đóng cửa trực tiếp từ server nên chỉ cần sửa `Code.gs` rồi deploy lại. Các hằng số cùng tên trong `index.html` chỉ dùng cho chế độ demo (`USE_LIVE_BACKEND = false`).
- **Hiệu ứng tuyết rơi** (`index.html`, hằng số `SNOW_UNTIL`): tự chạy đến hết 31/12/2026 theo ngày UK rồi tự tắt, không cần sửa gì thêm.
- Nếu muốn thêm dropdown chọn dịch vụ (Manicure/Pedicure/Gel...) sau này, nói mình biết — sẽ chỉnh cả form, Sheet và Calendar event.
- **Múi giờ**: code luôn tính giờ theo UK (`Europe/London`, tự động cộng/trừ giờ mùa hè BST) qua hằng số `TIMEZONE` trong `Code.gs`, không phụ thuộc múi giờ cấu hình của project Apps Script hay của Google Sheet nữa. Những dòng đã lỡ ghi sai giờ vào Sheet **trước khi có bản fix này** (ví dụ các dòng sync từ Calendar bị lệch giờ) sẽ không tự sửa lại — cần bạn kiểm tra và sửa tay cột "Time Slot"/"Date" cho các dòng cũ đó nếu cần.

