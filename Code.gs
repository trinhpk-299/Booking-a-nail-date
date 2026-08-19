/**
 * GLAM NAILS SUNDERLAND — BOOKING BACKEND
 * Deploy: Extensions > Apps Script trong Google Sheet > dán code này > Deploy > Web app
 *
 * Việc này làm:
 *  1. Kiểm tra chỗ trống cho 1 ngày (doGet)
 *  2. Nhận booking mới, ghi vào Sheet "Bookings" (doPost)
 *  3. Gửi email xác nhận cho khách
 *  4. Tạo sự kiện trên Google Calendar của salon (glamnails1409@gmail.com)
 *  5. syncManualCalendarEntries() — chạy định kỳ (đặt Trigger 15 phút/lần),
 *     quét Calendar tìm lịch bạn TỰ thêm tay (không phải từ web), tự ghi
 *     vào Sheet để web trừ chỗ đúng. Cần setup Trigger — xem HUONG-DAN-SETUP.md
 */

// ===================== CẤU HÌNH =====================
const MAX_PER_SLOT = 5;
const OPEN_HOUR = 10;   // 10:00
const CLOSE_HOUR = 18;  // 18:00 (slot cuối bắt đầu 17:00)
const SLOT_MINUTES = 60;

// Chủ nhật khai trương — mở đặc biệt dù các Chủ nhật khác đóng cửa
const SPECIAL_OPEN_SUNDAY = "2026-08-23";

const SALON_EMAIL = "glamnails1409@gmail.com";
const SALON_NAME = "Glam Nails Sunderland";
const SALON_ADDRESS = "35 Melbourne Pl, Sunderland SR4 8LN, UK";
const SALON_PHONE = "+44 7873 129148";

// Nhãn đánh dấu sự kiện được tạo TỪ WEB (để hàm sync không đếm trùng)
const WEBSITE_SOURCE_TAG = "glamnails_website_booking";
// Sync quét lịch trong khoảng từ hôm nay tới bao nhiêu ngày tới
const SYNC_LOOKAHEAD_DAYS = 60;
// ======================================================

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Bookings");
}

function ensureHeader_() {
  const sheet = getSheet_();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "Date", "Time Slot", "Customer Name", "Phone", "Email", "Notes", "Calendar Event ID"]);
  }
}

// Ngày đóng cửa: Chủ nhật, TRỪ ngày khai trương đặc biệt
function isClosedDate_(dateStr) {
  const dow = new Date(dateStr + "T00:00:00").getDay(); // 0 = Sunday
  if (dow !== 0) return false;
  return dateStr !== SPECIAL_OPEN_SUNDAY;
}

function pad_(n) {
  return n < 10 ? "0" + n : "" + n;
}

/* =========================================================
   GET — trả về danh sách khung giờ + tình trạng chỗ cho 1 ngày
   ========================================================= */
function doGet(e) {
  ensureHeader_();
  const dateStr = e.parameter.date;
  if (!dateStr) {
    return jsonOut_({ error: "Missing date" });
  }

  if (isClosedDate_(dateStr)) {
    return jsonOut_({ date: dateStr, closed: true, slots: [] });
  }

  // Short cache so repeated checks of the same date (e.g. user going back and
  // forth) don't re-scan the sheet every time — bookings still show up within
  // a few seconds since new bookings invalidate this date's cache entry.
  const cache = CacheService.getScriptCache();
  const cacheKey = "slots_" + dateStr;
  const cached = cache.get(cacheKey);
  if (cached) {
    return jsonOut_({ date: dateStr, closed: false, slots: JSON.parse(cached) });
  }

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const counts = {};
  if (lastRow > 1) {
    // Only read the Date + Time Slot columns instead of the whole sheet
    const data = sheet.getRange(2, 2, lastRow - 1, 2).getValues();
    for (let i = 0; i < data.length; i++) {
      const rowDate = formatDateCell_(data[i][0]);
      const rowSlot = data[i][1];
      if (rowDate === dateStr) {
        counts[rowSlot] = (counts[rowSlot] || 0) + 1;
      }
    }
  }

  const slots = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    const label = pad_(h) + ":00 - " + pad_(h + 1) + ":00";
    const booked = counts[label] || 0;
    slots.push({ time: label, full: booked >= MAX_PER_SLOT });
  }

  cache.put(cacheKey, JSON.stringify(slots), 20); // 20s TTL

  return jsonOut_({ date: dateStr, closed: false, slots: slots });
}

/* =========================================================
   POST — tạo booking mới: ghi Sheet + gửi email + tạo Calendar event
   ========================================================= */
function doPost(e) {
  ensureHeader_();
  const body = JSON.parse(e.postData.contents);
  const dateStr = body.date;
  const timeSlot = body.time;
  const name = (body.name || "").trim();
  const phone = (body.phone || "").trim();
  const email = (body.email || "").trim();
  const notes = (body.notes || "").trim();

  if (!dateStr || !timeSlot || !name || !phone || !email) {
    return jsonOut_({ success: false, error: "Missing required information." });
  }

  if (isClosedDate_(dateStr)) {
    return jsonOut_({ success: false, error: "Salon is closed on this date." });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let eventId = "";
  try {
    const sheet = getSheet_();
    const data = sheet.getDataRange().getValues();
    let count = 0;
    for (let i = 1; i < data.length; i++) {
      if (formatDateCell_(data[i][1]) === dateStr && data[i][2] === timeSlot) count++;
    }
    if (count >= MAX_PER_SLOT) {
      return jsonOut_({ success: false, error: "This time slot just filled up. Please choose another." });
    }

    // Tạo sự kiện Calendar TRƯỚC khi ghi Sheet để có event ID lưu lại
    try {
      eventId = createCalendarEvent_(dateStr, timeSlot, name, phone, email, notes);
    } catch (calErr) {
      eventId = "calendar_error: " + calErr.message;
    }

    sheet.appendRow([new Date(), dateStr, timeSlot, name, phone, email, notes, eventId]);
    CacheService.getScriptCache().remove("slots_" + dateStr);
  } finally {
    lock.releaseLock();
  }

  try {
    sendConfirmationEmail_(email, name, dateStr, timeSlot);
  } catch (err) {
    // Không chặn booking nếu gửi email lỗi
  }

  return jsonOut_({ success: true });
}

/* =========================================================
   Google Calendar — tạo sự kiện trên lịch của salon
   ========================================================= */
function createCalendarEvent_(dateStr, timeSlot, name, phone, email, notes) {
  const calendar = CalendarApp.getCalendarById(SALON_EMAIL) || CalendarApp.getDefaultCalendar();

  const startHour = parseInt(timeSlot.split(":")[0], 10);
  const start = new Date(dateStr + "T00:00:00");
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + SLOT_MINUTES);

  const title = "Nail Appointment — " + name;
  const description =
    "Customer: " + name + "\n" +
    "Phone: " + phone + "\n" +
    "Email: " + email + "\n" +
    (notes ? ("Notes: " + notes + "\n") : "") +
    "\nBooked via Glam Nails Sunderland website.";

  const event = calendar.createEvent(title, start, end, {
    location: SALON_ADDRESS,
    description: description,
    guests: email,
    sendInvites: true
  });

  // Đánh dấu sự kiện này đến từ web — để syncManualCalendarEntries() bỏ qua, không ghi trùng vào Sheet
  event.setTag(WEBSITE_SOURCE_TAG, "true");

  return event.getId();
}

/* =========================================================
   Email xác nhận cho khách
   ========================================================= */
function sendConfirmationEmail_(toEmail, name, dateStr, timeSlot) {
  const formattedDate = formatMMDDYYYY_(dateStr);
  const subject = "Booking Confirmed — " + SALON_NAME;
  const body =
    "Hi " + name + ",\n\n" +
    "Your appointment at " + SALON_NAME + " is confirmed:\n\n" +
    "Date: " + formattedDate + "\n" +
    "Time: " + timeSlot + "\n" +
    "Location: " + SALON_ADDRESS + "\n\n" +
    "This appointment has also been added to our calendar, and you should receive a Google Calendar invite at this email address shortly.\n\n" +
    "Need to reschedule or have a question? Call or text us at " + SALON_PHONE + ".\n\n" +
    "See you soon!\n" + SALON_NAME;

  MailApp.sendEmail({
    to: toEmail,
    subject: subject,
    body: body,
    name: SALON_NAME
  });
}

/* =========================================================
   SYNC — quét Calendar tìm lịch thêm tay, tự ghi vào Sheet
   Cách chạy: đặt Time-driven Trigger gọi hàm này mỗi 15 phút
   (xem hướng dẫn trong HUONG-DAN-SETUP.md)
   ========================================================= */
function syncManualCalendarEntries() {
  ensureHeader_();
  const calendar = CalendarApp.getCalendarById(SALON_EMAIL) || CalendarApp.getDefaultCalendar();
  const sheet = getSheet_();

  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - 1); // quét lùi 1 ngày để không sót lịch mới thêm cho hôm nay
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + SYNC_LOOKAHEAD_DAYS);

  const events = calendar.getEvents(rangeStart, rangeEnd);

  // Lấy danh sách Calendar Event ID đã có sẵn trong Sheet để tránh ghi trùng
  const data = sheet.getDataRange().getValues();
  const existingIds = {};
  for (let i = 1; i < data.length; i++) {
    const id = data[i][7]; // cột "Calendar Event ID"
    if (id) existingIds[id] = true;
  }

  let addedCount = 0;

  events.forEach(event => {
    const eventId = event.getId();

    // Bỏ qua nếu sự kiện đến từ web (đã có tag) hoặc đã được ghi vào Sheet rồi
    if (event.getTag(WEBSITE_SOURCE_TAG) === "true") return;
    if (existingIds[eventId]) return;
    if (event.isAllDayEvent()) return; // bỏ qua sự kiện cả ngày (vd: ngày lễ, ghi chú)

    const start = event.getStartTime();
    const dateStr = Utilities.formatDate(start, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const hour = start.getHours();
    const timeSlot = pad_(hour) + ":00 - " + pad_(hour + 1) + ":00";

    const guests = event.getGuestList();
    const guestEmail = guests.length > 0 ? guests[0].getEmail() : "";

    sheet.appendRow([
      new Date(),               // Timestamp
      dateStr,                  // Date
      timeSlot,                 // Time Slot
      event.getTitle() || "Manual booking (Calendar)", // Customer Name
      "",                       // Phone — không có sẵn từ Calendar, để trống
      guestEmail,                // Email nếu có khách mời
      "Synced from Google Calendar", // Notes
      eventId                   // Calendar Event ID — đánh dấu đã sync
    ]);

    existingIds[eventId] = true;
    addedCount++;
  });

  Logger.log("Sync xong. Đã thêm " + addedCount + " lịch từ Calendar vào Sheet.");
}

/* =========================================================
   KEEP-WARM — gọi hàm rỗng này mỗi vài phút (Trigger riêng, xem
   HUONG-DAN-SETUP.md) để giảm độ trễ "cold start" của web app
   ========================================================= */
function keepWarm() {
  ensureHeader_();
}

/* =========================================================
   Helpers
   ========================================================= */
function formatDateCell_(cellValue) {
  // Sheet có thể lưu date dưới dạng Date object hoặc string — chuẩn hóa về YYYY-MM-DD
  if (Object.prototype.toString.call(cellValue) === "[object Date]") {
    return Utilities.formatDate(cellValue, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return cellValue;
}

function formatMMDDYYYY_(dateStr) {
  const parts = dateStr.split("-"); // yyyy-mm-dd
  return parts[1] + "/" + parts[2] + "/" + parts[0];
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
