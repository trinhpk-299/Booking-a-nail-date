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
const MAX_PER_SLOT = 3;
const OPEN_HOUR = 10;   // 10:00
const CLOSE_HOUR = 18;  // 18:00 (slot cuối bắt đầu 17:00)
const SLOT_MINUTES = 60;

// Luôn dùng giờ UK (tự động cộng/trừ giờ mùa hè BST), không phụ thuộc
// múi giờ cấu hình của project Apps Script (Cài đặt dự án > Múi giờ).
const TIMEZONE = "Europe/London";

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

// Dịch vụ + thời lượng (phút). Phải khớp với SERVICES trong index.html.
const SERVICES = {
  "For Your Hands": 60,
  "For Your Toes": 30,
  "Plus Nail Art": 30,
  "Full Spa Pedicure": 45
};

// Màu chữ cho các dòng lịch hẹn đã trôi qua (xám đậm)
const PAST_TEXT_COLOR = "#666666";
// ======================================================

const SHEET_HEADERS = ["Timestamp", "Date", "Time Slot", "Customer Name", "Phone", "Email", "Notes", "Calendar Event ID", "Services", "Duration (mins)"];

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Bookings");
}

function ensureHeader_() {
  const sheet = getSheet_();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEET_HEADERS);
    return;
  }
  // Sheet có sẵn dữ liệu từ trước khi có cột Services/Duration — bổ sung
  // thêm các cột còn thiếu vào cuối header, không đụng tới cột cũ.
  const existingHeader = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (existingHeader.length < SHEET_HEADERS.length) {
    const missing = SHEET_HEADERS.slice(existingHeader.length);
    sheet.getRange(1, existingHeader.length + 1, 1, missing.length).setValues([missing]);
  }
}

// Tính tổng thời lượng (phút) từ danh sách tên dịch vụ. Trả về -1 nếu có
// dịch vụ không hợp lệ (không có trong SERVICES) hoặc danh sách rỗng.
function computeDurationMinutes_(servicesList) {
  if (!servicesList || !servicesList.length) return -1;
  let total = 0;
  for (let i = 0; i < servicesList.length; i++) {
    const minutes = SERVICES[servicesList[i]];
    if (!minutes) return -1;
    total += minutes;
  }
  return total;
}

// Sắp xếp các dòng (trừ header) theo Date rồi Time Slot tăng dần.
// Cột Date/Time Slot là chuỗi "yyyy-MM-dd" / "HH:00 - HH:00" nên sort chữ = sort đúng thời gian.
function sortBookingsSheet_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn())
    .sort([{ column: 2, ascending: true }, { column: 3, ascending: true }]);
}

// Cột Date (B) phải luôn là VĂN BẢN THUẦN "yyyy-MM-dd". Nếu để Sheets tự
// nhận dạng đây là kiểu Date, nó sẽ lưu theo múi giờ riêng của Sheet (khác
// TIMEZONE ở trên) — khi đọc lại có thể bị lệch sang ngày trước/sau, làm
// đếm sai số chỗ đã đặt của 1 ngày (khách vẫn đặt được dù đã đủ chỗ).
function ensureDateColumnIsText_() {
  const sheet = getSheet_();
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) {
    sheet.getRange(2, 2, maxRows - 1, 1).setNumberFormat("@");
  }
}

// Chạy 1 LẦN: ép định dạng cột Date thành text vĩnh viễn (cho các dòng
// sau này) và chuẩn hoá lại các dòng hiện có nếu đang bị lưu sai kiểu Date.
function normalizeDateColumn() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();

  ensureDateColumnIsText_();

  if (lastRow < 2) {
    Logger.log("Không có dữ liệu để chuẩn hoá.");
    return;
  }

  const range = sheet.getRange(2, 2, lastRow - 1, 1);
  const values = range.getValues();
  const normalized = values.map(function (r) { return [formatDateCell_(r[0])]; });
  range.setValues(normalized);

  sortBookingsSheet_();
  Logger.log("Đã chuẩn hoá cột Date (text) cho " + normalized.length + " dòng.");
}

// Bấm Run hàm này bất cứ lúc nào để sắp xếp lại ngay dữ liệu hiện có trong Sheet.
function sortBookingsNow() {
  sortBookingsSheet_();
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

// Đọc 1 mốc ngày+giờ theo đúng giờ UK (tự xử lý BST/GMT), bất kể múi giờ
// cấu hình của project là gì.
function ukDateTime_(dateStr, hour) {
  const wallClock = dateStr + " " + pad_(hour) + ":00:00";
  return Utilities.parseDate(wallClock, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
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
  const servicesList = Array.isArray(body.services) ? body.services : [];

  if (!dateStr || !timeSlot || !name || !phone || !email || !servicesList.length) {
    return jsonOut_({ success: false, error: "Missing required information." });
  }

  const durationMinutes = computeDurationMinutes_(servicesList);
  if (durationMinutes <= 0) {
    return jsonOut_({ success: false, error: "Invalid service selection." });
  }

  if (isClosedDate_(dateStr)) {
    return jsonOut_({ success: false, error: "Salon is closed on this date." });
  }

  const startHourCheck = parseInt(timeSlot.split(":")[0], 10);
  if (isNaN(startHourCheck) || ukDateTime_(dateStr, startHourCheck).getTime() < Date.now()) {
    return jsonOut_({ success: false, error: "This time slot is in the past. Please choose another." });
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
      eventId = createCalendarEvent_(dateStr, timeSlot, name, phone, email, notes, servicesList, durationMinutes);
    } catch (calErr) {
      eventId = "calendar_error: " + calErr.message;
    }

    sheet.appendRow([new Date(), dateStr, timeSlot, name, phone, email, notes, eventId, servicesList.join(", "), durationMinutes]);
    sortBookingsSheet_();
    CacheService.getScriptCache().remove("slots_" + dateStr);
  } finally {
    lock.releaseLock();
  }

  try {
    sendConfirmationEmail_(email, name, dateStr, timeSlot, servicesList, durationMinutes);
  } catch (err) {
    // Không chặn booking nếu gửi email lỗi
  }

  return jsonOut_({ success: true });
}

/* =========================================================
   Google Calendar — tạo sự kiện trên lịch của salon
   ========================================================= */
function createCalendarEvent_(dateStr, timeSlot, name, phone, email, notes, servicesList, durationMinutes) {
  const calendar = CalendarApp.getCalendarById(SALON_EMAIL) || CalendarApp.getDefaultCalendar();

  const startHour = parseInt(timeSlot.split(":")[0], 10);
  const start = ukDateTime_(dateStr, startHour);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const title = "Nail Appointment — " + name;
  const description =
    "Customer: " + name + "\n" +
    "Phone: " + phone + "\n" +
    "Email: " + email + "\n" +
    "Services: " + servicesList.join(", ") + " (" + durationMinutes + " mins)\n" +
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
function sendConfirmationEmail_(toEmail, name, dateStr, timeSlot, servicesList, durationMinutes) {
  const formattedDate = formatMMDDYYYY_(dateStr);
  const subject = "Booking Confirmed — " + SALON_NAME;
  const body =
    "Hi " + name + ",\n\n" +
    "Your appointment at " + SALON_NAME + " is confirmed:\n\n" +
    "Date: " + formattedDate + "\n" +
    "Time: " + timeSlot + "\n" +
    "Services: " + servicesList.join(", ") + "\n" +
    "Estimated duration: " + durationMinutes + " minutes\n" +
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
    const dateStr = Utilities.formatDate(start, TIMEZONE, "yyyy-MM-dd");
    const hour = parseInt(Utilities.formatDate(start, TIMEZONE, "H"), 10);
    const timeSlot = pad_(hour) + ":00 - " + pad_(hour + 1) + ":00";

    const guests = event.getGuestList();
    const guestEmail = guests.length > 0 ? guests[0].getEmail() : "";
    const durationMins = Math.round((event.getEndTime().getTime() - start.getTime()) / 60000);

    sheet.appendRow([
      new Date(),               // Timestamp
      dateStr,                  // Date
      timeSlot,                 // Time Slot
      event.getTitle() || "Manual booking (Calendar)", // Customer Name
      "",                       // Phone — không có sẵn từ Calendar, để trống
      guestEmail,                // Email nếu có khách mời
      "Synced from Google Calendar", // Notes
      eventId,                  // Calendar Event ID — đánh dấu đã sync
      "",                       // Services — không có sẵn từ Calendar
      durationMins              // Duration (mins) — tính từ giờ thật của sự kiện
    ]);

    existingIds[eventId] = true;
    addedCount++;
  });

  if (addedCount > 0) {
    sortBookingsSheet_();
  }

  formatPastBookings_();

  Logger.log("Sync xong. Đã thêm " + addedCount + " lịch từ Calendar vào Sheet.");
}

/* =========================================================
   TÔ XÁM LỊCH HẸN ĐÃ QUA — dòng nào có giờ bắt đầu (theo giờ UK)
   đã ở trong quá khứ sẽ được chuyển màu chữ sang xám đậm.
   ========================================================= */
function formatPastBookings_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const numCols = sheet.getLastColumn();
  const dataRange = sheet.getRange(2, 1, lastRow - 1, numCols);
  const dateTimeValues = sheet.getRange(2, 2, lastRow - 1, 2).getValues();
  const now = Date.now();

  const colorGrid = [];
  for (let i = 0; i < dateTimeValues.length; i++) {
    const dateStr = formatDateCell_(dateTimeValues[i][0]);
    const timeSlot = dateTimeValues[i][1];
    let isPast = false;
    if (dateStr && timeSlot) {
      const startHour = parseInt(String(timeSlot).split(":")[0], 10);
      if (!isNaN(startHour)) {
        isPast = ukDateTime_(dateStr, startHour).getTime() < now;
      }
    }
    const rowColors = [];
    for (let c = 0; c < numCols; c++) {
      rowColors.push(isPast ? PAST_TEXT_COLOR : null);
    }
    colorGrid.push(rowColors);
  }

  dataRange.setFontColors(colorGrid);
}

// Bấm Run bất cứ lúc nào để tô xám ngay các lịch hẹn đã qua giờ hẹn.
function refreshPastBookingFormatting() {
  formatPastBookings_();
}

/* =========================================================
   KEEP-WARM — gọi hàm rỗng này mỗi vài phút (Trigger riêng, xem
   HUONG-DAN-SETUP.md) để giảm độ trễ "cold start" của web app
   ========================================================= */
function keepWarm() {
  ensureHeader_();
  formatPastBookings_();
}

/* =========================================================
   SỬA DỮ LIỆU CŨ BỊ LỆCH GIỜ (chạy 1 LẦN, sau khi đã deploy
   bản code có TIMEZONE fix)

   Cách chạy: trong Apps Script, chọn hàm ở thanh trên cùng rồi
   bấm Run (▶):
     1. previewTimezoneFix  — chỉ xem log, KHÔNG sửa gì cả
     2. Mở "Nhật ký thực thi" (Execution log) đọc kỹ danh sách
     3. Nếu ổn, chạy applyTimezoneFix để sửa thật

   - Dòng "Synced from Google Calendar": sự kiện Calendar là
     chuẩn → sửa lại cột Date/Time Slot trong Sheet cho khớp.
   - Dòng đặt từ web: Sheet là chuẩn (đúng như khách chọn) →
     dời lại giờ sự kiện Calendar cho khớp. Việc dời sự kiện có
     thể gửi email "cập nhật lịch hẹn" tới khách thật, nên hãy
     xem preview trước khi applyTimezoneFix.
   ========================================================= */
function previewTimezoneFix() {
  fixHistoricalTimezoneBug_(true);
}

function applyTimezoneFix() {
  fixHistoricalTimezoneBug_(false);
}

function fixHistoricalTimezoneBug_(dryRun) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("Không có dữ liệu để kiểm tra.");
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues(); // A:H
  let sheetFixed = 0;
  let eventsMoved = 0;
  let skipped = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;
    const dateStr = formatDateCell_(row[1]);
    const timeSlot = row[2];
    const notes = row[6];
    const eventId = row[7];

    if (!eventId || String(eventId).indexOf("calendar_error") === 0) {
      skipped++;
      continue;
    }

    let event;
    try {
      event = CalendarApp.getEventById(eventId);
    } catch (err) {
      event = null;
    }
    if (!event) {
      skipped++;
      continue;
    }

    const isSynced = notes === "Synced from Google Calendar";

    if (isSynced) {
      const actualStart = event.getStartTime();
      const correctDateStr = Utilities.formatDate(actualStart, TIMEZONE, "yyyy-MM-dd");
      const correctHour = parseInt(Utilities.formatDate(actualStart, TIMEZONE, "H"), 10);
      const correctTimeSlot = pad_(correctHour) + ":00 - " + pad_(correctHour + 1) + ":00";

      if (correctDateStr !== dateStr || correctTimeSlot !== timeSlot) {
        Logger.log(
          "Dòng " + rowNum + " (sync từ Calendar): " + dateStr + " " + timeSlot +
          "  ->  " + correctDateStr + " " + correctTimeSlot
        );
        if (!dryRun) {
          sheet.getRange(rowNum, 2).setValue(correctDateStr);
          sheet.getRange(rowNum, 3).setValue(correctTimeSlot);
        }
        sheetFixed++;
      }
    } else {
      if (!dateStr || !timeSlot) { skipped++; continue; }
      const startHour = parseInt(timeSlot.split(":")[0], 10);
      const correctStart = ukDateTime_(dateStr, startHour);
      const correctEnd = new Date(correctStart.getTime() + SLOT_MINUTES * 60000);
      const actualStart = event.getStartTime();

      if (Math.abs(actualStart.getTime() - correctStart.getTime()) > 60000) {
        Logger.log(
          "Dòng " + rowNum + " (booking web) — sự kiện Calendar đang ở " +
          Utilities.formatDate(actualStart, TIMEZONE, "yyyy-MM-dd HH:mm") +
          " (UK), sẽ dời về " + dateStr + " " + timeSlot
        );
        if (!dryRun) {
          event.setTime(correctStart, correctEnd);
        }
        eventsMoved++;
      }
    }
  }

  Logger.log(
    (dryRun ? "[XEM TRƯỚC — chưa sửa gì] " : "[ĐÃ SỬA] ") +
    sheetFixed + " dòng Sheet (từ sync Calendar) cần sửa, " +
    eventsMoved + " sự kiện Calendar (booking web) cần dời giờ, " +
    "bỏ qua " + skipped + " dòng (thiếu Event ID hoặc event đã bị xóa)."
  );
}

/* =========================================================
   Helpers
   ========================================================= */
function formatDateCell_(cellValue) {
  // Sheet có thể lưu date dưới dạng Date object hoặc string — chuẩn hóa về YYYY-MM-DD
  if (Object.prototype.toString.call(cellValue) === "[object Date]") {
    return Utilities.formatDate(cellValue, TIMEZONE, "yyyy-MM-dd");
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
