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
const SLOT_MINUTES = 60;

// Giờ mở cửa theo thứ trong tuần (giờ UK). 0 = Chủ nhật ... 6 = Thứ bảy.
// "close" có thể lẻ (vd 16.5 = 16:30) — khung cuối sẽ tự rút ngắn cho vừa.
const HOURS_BY_DOW = {
  0: { open: 10, close: 16.5 }, // Chủ nhật: 10:00 - 16:30, ca cuối bắt đầu 16:00
  1: { open: 10, close: 18 },
  2: { open: 10, close: 18 },
  3: { open: 10, close: 18 },
  4: { open: 10, close: 18 },
  5: { open: 10, close: 18 },
  6: { open: 10, close: 18 }
};

// Giờ mở cửa riêng cho các ngày/khoảng ngày cụ thể — ưu tiên hơn HOURS_BY_DOW.
// Mùa lễ cuối năm 2026. "closed: true" = nghỉ cả ngày. Giờ lẻ dùng số thập phân
// (8.5 = 08:30). Khung đầu tính từ giờ mở cửa, khung cuối tự rút ngắn cho vừa.
const HOURS_OVERRIDES = [
  { from: "2026-12-14", to: "2026-12-23", open: 8.5, close: 20 },
  { from: "2026-12-24", to: "2026-12-24", open: 8.5, close: 17 },   // Christmas Eve
  { from: "2026-12-25", to: "2026-12-26", closed: true },
  { from: "2026-12-27", to: "2026-12-31", open: 9, close: 18.5 },
  { from: "2027-01-01", to: "2027-01-01", closed: true },           // New Year's Day
  { from: "2027-01-02", to: "2027-01-02", open: 9, close: 18.5 }
];

// Trong khoảng ngày này (hết mùa lễ) mỗi khung giờ chỉ nhận ít chỗ hơn.
const REDUCED_CAPACITY_FROM = "2026-12-20";
const REDUCED_CAPACITY_TO = "2027-01-02";
const REDUCED_MAX_PER_SLOT = 2;

// Luôn dùng giờ UK (tự động cộng/trừ giờ mùa hè BST), không phụ thuộc
// múi giờ cấu hình của project Apps Script (Cài đặt dự án > Múi giờ).
const TIMEZONE = "Europe/London";

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
    ensureDateColumnIsText_();
    return;
  }
  // Sheet có sẵn dữ liệu từ trước khi có cột Services/Duration — bổ sung
  // thêm các cột còn thiếu vào cuối header, không đụng tới cột cũ.
  const existingHeader = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (existingHeader.length < SHEET_HEADERS.length) {
    const missing = SHEET_HEADERS.slice(existingHeader.length);
    sheet.getRange(1, existingHeader.length + 1, 1, missing.length).setValues([missing]);
  }
  // Luôn ép lại định dạng cột Date thành text mỗi lần có request — phòng
  // trường hợp định dạng bị Sheets/thao tác dán đè làm mất đi, gây đếm
  // sai chỗ trống (đã từng xảy ra thật).
  ensureDateColumnIsText_();
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

// Salon mở cửa tất cả các ngày trong tuần — chỉ đóng khi là ngày nghỉ trong
// HOURS_OVERRIDES hoặc có trong tab "Closed Dates".
function isClosedDate_(dateStr) {
  if (getHoursForDate_(dateStr).closed) return true;
  return !!getClosedDatesSet_()[dateStr];
}

function dayOfWeek_(dateStr) {
  return new Date(dateStr + "T00:00:00").getDay(); // 0 = Sunday ... 6 = Saturday
}

// Giờ mở cửa của 1 ngày: ưu tiên HOURS_OVERRIDES, nếu không có thì theo thứ.
function getHoursForDate_(dateStr) {
  for (let i = 0; i < HOURS_OVERRIDES.length; i++) {
    const o = HOURS_OVERRIDES[i];
    if (dateStr >= o.from && dateStr <= o.to) return o;
  }
  return HOURS_BY_DOW[dayOfWeek_(dateStr)];
}

// Số chỗ tối đa mỗi khung giờ của 1 ngày.
function maxPerSlot_(dateStr) {
  const reduced = dateStr >= REDUCED_CAPACITY_FROM && dateStr <= REDUCED_CAPACITY_TO;
  return reduced ? REDUCED_MAX_PER_SLOT : MAX_PER_SLOT;
}

function formatHourLabel_(hourDecimal) {
  const h = Math.floor(hourDecimal);
  const m = Math.round((hourDecimal - h) * 60);
  return pad_(h) + ":" + pad_(m);
}

// "08:30 - 09:30" -> 8.5 (giờ bắt đầu) / 9.5 (giờ kết thúc), dạng thập phân.
function slotStartHour_(label) {
  const p = String(label).split(" - ")[0].split(":");
  return parseInt(p[0], 10) + parseInt(p[1], 10) / 60;
}

function slotEndHour_(label) {
  const p = String(label).split(" - ")[1].split(":");
  return parseInt(p[0], 10) + parseInt(p[1], 10) / 60;
}

// Danh sách nhãn khung giờ cho 1 ngày. Khung đầu bắt đầu đúng giờ mở cửa,
// khung cuối tự rút ngắn nếu giờ đóng cửa lệch (vd Chủ nhật đóng 16:30 ->
// khung cuối "16:00 - 16:30" thay vì đủ 1 tiếng).
function buildSlotLabels_(dateStr) {
  const hours = getHoursForDate_(dateStr);
  const labels = [];
  if (hours.closed) return labels;
  for (let h = hours.open; h < hours.close; h++) {
    const end = Math.min(h + 1, hours.close);
    labels.push(formatHourLabel_(h) + " - " + formatHourLabel_(end));
  }
  return labels;
}

// Khung giờ của ngày đó chứa mốc giờ (thập phân) cho trước, hoặc null nếu
// mốc đó nằm ngoài giờ mở cửa.
function slotLabelForTime_(dateStr, hourDecimal) {
  const labels = buildSlotLabels_(dateStr);
  for (let i = 0; i < labels.length; i++) {
    if (hourDecimal >= slotStartHour_(labels[i]) && hourDecimal < slotEndHour_(labels[i])) {
      return labels[i];
    }
  }
  return null;
}

// Tab "Closed Dates" — cho phép chủ salon tự đóng cửa 1 ngày bất kỳ
// bằng cách gõ thêm dòng vào Sheet, không cần sửa code.
const CLOSED_DATES_SHEET = "Closed Dates";

function ensureClosedDatesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CLOSED_DATES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CLOSED_DATES_SHEET);
    sheet.appendRow(["Date (yyyy-mm-dd)", "Note (optional)"]);
  }
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) {
    sheet.getRange(2, 1, maxRows - 1, 1).setNumberFormat("@"); // tránh Sheets tự đổi thành kiểu Date
  }
  return sheet;
}

function getClosedDatesSet_() {
  const sheet = ensureClosedDatesSheet_();
  const lastRow = sheet.getLastRow();
  const set = {};
  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      const d = formatDateCell_(values[i][0]);
      if (d) set[d] = true;
    }
  }
  return set;
}

function pad_(n) {
  return n < 10 ? "0" + n : "" + n;
}

// Đọc 1 mốc ngày+giờ theo đúng giờ UK (tự xử lý BST/GMT), bất kể múi giờ
// cấu hình của project là gì.
// "hour" có thể là số thập phân (8.5 = 08:30).
function ukDateTime_(dateStr, hour) {
  const wallClock = dateStr + " " + formatHourLabel_(hour) + ":00";
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

  // "past" luôn tính theo giờ UK thật (Date.now() là mốc thời gian tuyệt đối,
  // không phụ thuộc múi giờ thiết bị khách) — không dựa vào đồng hồ trình duyệt.
  const nowMs = Date.now();
  const maxPerSlot = maxPerSlot_(dateStr);
  const slots = buildSlotLabels_(dateStr).map(function (label) {
    const booked = counts[label] || 0;
    const isPast = ukDateTime_(dateStr, slotStartHour_(label)).getTime() < nowMs;
    return { time: label, full: booked >= maxPerSlot, past: isPast };
  });

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

  if (buildSlotLabels_(dateStr).indexOf(timeSlot) === -1) {
    return jsonOut_({ success: false, error: "Invalid time slot for this date." });
  }

  if (ukDateTime_(dateStr, slotStartHour_(timeSlot)).getTime() < Date.now()) {
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
    if (count >= maxPerSlot_(dateStr)) {
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

  const start = ukDateTime_(dateStr, slotStartHour_(timeSlot));
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
    const minute = parseInt(Utilities.formatDate(start, TIMEZONE, "m"), 10);
    // Gán vào đúng khung giờ của ngày đó (khung có thể lệch 30 phút vào mùa lễ);
    // nếu sự kiện nằm ngoài giờ mở cửa thì giữ nhãn theo giờ tròn như trước.
    const timeSlot = slotLabelForTime_(dateStr, hour + minute / 60) ||
      (pad_(hour) + ":00 - " + pad_(hour + 1) + ":00");

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
      const startHour = slotStartHour_(timeSlot);
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
      const correctStart = ukDateTime_(dateStr, slotStartHour_(timeSlot));
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
  // Sheet có thể lưu date dưới dạng Date object hoặc string — chuẩn hóa về YYYY-MM-DD.
  // Nếu Sheets đã tự nhận dạng ô này thành kiểu Date (bất chấp định dạng text ta
  // ép), nó quy đổi chuỗi "yyyy-MM-dd" thành 1 mốc thời gian tuyệt đối bằng
  // MÚI GIỜ RIÊNG CỦA SPREADSHEET (không phải TIMEZONE=UK ở trên) — nên phải
  // "dịch ngược" bằng đúng múi giờ đó mới ra lại đúng ngày ban đầu; nếu lấy
  // theo TIMEZONE (UK) sẽ có thể bị lệch sang ngày trước/sau.
  if (Object.prototype.toString.call(cellValue) === "[object Date]") {
    const sheetTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(cellValue, sheetTz, "yyyy-MM-dd");
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

/* =========================================================
   CHIẾN DỊCH EMAIL GIÁNG SINH
   Danh sách khách nằm ở tab "Xmas Email List" (import từ Xmas_Email_List.csv)
   cùng Spreadsheet với tab Bookings. Chỉ gửi cho dòng Status = SEND (CHECK/EXCLUDE
   do người duyệt đặt tay). Các bước chạy (trong Apps Script, chọn hàm rồi bấm Run):
     1. sendChristmasTest          — gửi 1 email thử tới chính hộp thư chạy script
     2. previewChristmasBatch      — xem log sẽ gửi cho ai (không gửi gì)
     3. sendChristmasBatch         — gửi thật (tối đa ~95 email/lần), ghi giờ gửi vào cột Sent.
        Lần gửi thật đầu tiên tự "chốt" danh sách: chỉ gửi cho các email có trong tab
        lúc đó, dòng thêm vào sau sẽ bị bỏ qua (freezeChristmasRecipients = chốt/chốt lại)
     4. setupChristmasTrigger      — đặt lịch tự chạy sendChristmasBatch mỗi ngày
        lúc 10h (giờ UK) cho tới khi gửi hết thì trigger tự xóa
   ========================================================= */
const XMAS_SHEET_NAME = "Xmas Email List";
const XMAS_TEMPLATE_NAME = "christmas_email";  // tên file HTML trong project Apps Script (không gồm .html)
const XMAS_GIF_FILE_ID = "GIF_FILE_ID";        // ID file christmas_header.gif trên Google Drive
const XMAS_SENDER_NAME = "Jenny at Glam Nails";
const XMAS_SUBJECT_EMOJI = "\uD83C\uDF84";     // viết dạng escape vì ghi trực tiếp emoji dễ lỗi font
const XMAS_DAILY_LIMIT = 95;                   // tối đa mỗi lần chạy
const XMAS_QUOTA_RESERVE = 5;                  // chừa lại cho email xác nhận đặt lịch của khách (cùng hạn mức ~100/ngày)
const XMAS_MAX_RUN_MS = 270000;                // dừng trước giới hạn 6 phút của Apps Script
const XMAS_RECIPIENTS_KEY = "XMAS_RECIPIENTS"; // danh sách email đã "chốt", lưu trong Script Properties
const XMAS_PROP_CHUNK = 8000;                  // mỗi property tối đa ~9KB nên chia nhỏ khi lưu

// Danh sách email được phép nhận được "chốt" ở lần gửi thật đầu tiên (hoặc khi
// chạy freezeChristmasRecipients). Từ đó chỉ gửi cho đúng các email này — dòng
// nào thêm vào tab sau thời điểm chốt sẽ bị bỏ qua.
function saveXmasRecipients_(emails) {
  const props = PropertiesService.getScriptProperties();
  const old = parseInt(props.getProperty(XMAS_RECIPIENTS_KEY + "_n") || "0", 10);
  for (let i = 0; i < old; i++) props.deleteProperty(XMAS_RECIPIENTS_KEY + "_" + i);
  const json = JSON.stringify(emails);
  const n = Math.ceil(json.length / XMAS_PROP_CHUNK);
  for (let i = 0; i < n; i++) {
    props.setProperty(XMAS_RECIPIENTS_KEY + "_" + i, json.substr(i * XMAS_PROP_CHUNK, XMAS_PROP_CHUNK));
  }
  props.setProperty(XMAS_RECIPIENTS_KEY + "_n", String(n));
}

// Mảng email đã chốt, hoặc null nếu chưa chốt lần nào.
function loadXmasRecipients_() {
  const props = PropertiesService.getScriptProperties();
  const n = props.getProperty(XMAS_RECIPIENTS_KEY + "_n");
  if (n === null) return null;
  let json = "";
  for (let i = 0; i < parseInt(n, 10); i++) json += props.getProperty(XMAS_RECIPIENTS_KEY + "_" + i);
  return JSON.parse(json || "[]");
}

function freezeXmasPending_(pending) {
  const seen = {};
  const emails = [];
  pending.forEach(function (p) {
    if (!seen[p.email]) { seen[p.email] = true; emails.push(p.email); }
  });
  saveXmasRecipients_(emails);
  return emails.length;
}

// Chốt (hoặc chốt lại) danh sách = các dòng đang Status = SEND, Sent trống, ngay lúc này.
function freezeChristmasRecipients() {
  const n = freezeXmasPending_(readXmasPending_(readXmasList_()).pending);
  Logger.log("Đã chốt danh sách: " + n + " email. Email thêm vào tab sau lúc này sẽ KHÔNG được gửi (muốn thêm thì chạy lại freezeChristmasRecipients).");
}

// Các dòng cần gửi: Status = SEND, Sent trống, có email; kèm tập email đã gửi rồi.
function readXmasPending_(list) {
  const col = list.col;
  const sentEmails = {};
  const pending = [];
  for (let r = 1; r < list.values.length; r++) {
    const row = list.values[r];
    const email = String(row[col["Email"]]).trim().toLowerCase();
    const sent = String(row[col["Sent"]]).trim();
    if (sent && email) sentEmails[email] = true;
    if (sent || !email) continue;
    if (String(row[col["Status"]]).trim().toUpperCase() !== "SEND") continue;
    pending.push({ rowNum: r + 1, email: email, firstName: String(row[col["First Name"]]).trim() });
  }
  return { pending: pending, sentEmails: sentEmails };
}

function readXmasList_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(XMAS_SHEET_NAME);
  if (!sheet) {
    throw new Error('Không thấy tab "' + XMAS_SHEET_NAME + '" — hãy import Xmas_Email_List.csv thành tab này trước.');
  }
  const values = sheet.getDataRange().getValues();
  const header = values[0].map(function (h) { return String(h).trim(); });
  const col = {};
  ["First Name", "Email", "Status", "Sent"].forEach(function (name) {
    const i = header.indexOf(name);
    if (i === -1) throw new Error('Tab "' + XMAS_SHEET_NAME + '" thiếu cột "' + name + '".');
    col[name] = i;
  });
  return { sheet: sheet, values: values, col: col };
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Đọc template HTML + ảnh GIF header; báo lỗi rõ ràng nếu chưa cấu hình đủ.
function loadXmasAssets_() {
  if (!XMAS_GIF_FILE_ID || XMAS_GIF_FILE_ID === "GIF_FILE_ID") {
    throw new Error("Chưa điền XMAS_GIF_FILE_ID (ID file christmas_header.gif trên Google Drive).");
  }
  const template = HtmlService.createHtmlOutputFromFile(XMAS_TEMPLATE_NAME).getContent();
  if (template.indexOf("{First name}") === -1 || template.indexOf("{HEADER_IMG}") === -1) {
    throw new Error('File HTML "' + XMAS_TEMPLATE_NAME + '" thiếu {First name} hoặc {HEADER_IMG}.');
  }
  return { template: template, gif: DriveApp.getFileById(XMAS_GIF_FILE_ID).getBlob() };
}

function sendXmasEmail_(to, name, assets) {
  const safeName = escapeHtml_(name);
  const html = assets.template
    .replace(/\{First name\}/g, function () { return safeName; })
    .replace("{HEADER_IMG}", "cid:snowHeader");
  MailApp.sendEmail({
    to: to,
    subject: name + ", you get first pick of our Christmas slots " + XMAS_SUBJECT_EMOJI,
    htmlBody: html,
    inlineImages: { snowHeader: assets.gif },
    name: XMAS_SENDER_NAME
  });
}

// Gửi 1 email thử (đúng template + GIF) tới hộp thư của tài khoản đang chạy
// script (glamnails1409@gmail.com) để xem trước khi gửi hàng loạt. Không đụng
// tới tab Xmas Email List.
function sendChristmasTest() {
  const to = Session.getEffectiveUser().getEmail();
  sendXmasEmail_(to, "Test", loadXmasAssets_());
  Logger.log("Đã gửi email thử tới " + to + " — kiểm tra hộp thư (cả mục Spam) rồi mới chạy sendChristmasBatch.");
}

function previewChristmasBatch() { sendChristmasBatch_(true); }
function sendChristmasBatch() { sendChristmasBatch_(false); }

// Gửi cho các dòng Status = SEND và cột Sent còn trống, tối đa XMAS_DAILY_LIMIT
// (và không vượt hạn mức MailApp còn lại trong ngày). Ghi giờ gửi (giờ UK) vào
// cột Sent ngay sau mỗi email; lỗi thì ghi "ERROR: ..." để không bị gửi lại.
function sendChristmasBatch_(dryRun) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log("Một lần gửi khác đang chạy — bỏ qua lần này.");
    return;
  }
  try {
    const list = readXmasList_();
    const col = list.col;

    const read = readXmasPending_(list);
    const sentEmails = read.sentEmails;
    let pending = read.pending;

    // Chỉ gửi cho danh sách đã chốt; email thêm vào tab sau đó bị bỏ qua.
    const frozen = loadXmasRecipients_();
    if (frozen) {
      const allowed = {};
      frozen.forEach(function (e) { allowed[e] = true; });
      const ignored = pending.filter(function (p) { return !allowed[p.email]; });
      pending = pending.filter(function (p) { return allowed[p.email]; });
      if (ignored.length) {
        Logger.log("Bỏ qua " + ignored.length + " email thêm vào sau khi chốt danh sách: " +
          ignored.slice(0, 10).map(function (p) { return p.email; }).join(", ") + (ignored.length > 10 ? ", ..." : ""));
      }
    } else if (dryRun) {
      Logger.log("[XEM TRƯỚC] Chưa chốt danh sách — lần gửi thật đầu tiên sẽ tự chốt " + pending.length + " dòng hiện có.");
    }

    if (!pending.length) {
      Logger.log("Không còn khách nào cần gửi (Status = SEND và Sent trống).");
      if (!dryRun) removeChristmasTriggers_();
      return;
    }

    const assets = loadXmasAssets_();

    const quotaLeft = MailApp.getRemainingDailyQuota();
    const limit = Math.max(0, Math.min(XMAS_DAILY_LIMIT, quotaLeft - XMAS_QUOTA_RESERVE));
    Logger.log("Cần gửi " + pending.length + " khách; hạn mức MailApp còn " + quotaLeft + " -> lần này gửi tối đa " + limit + ".");
    if (!limit) return;

    if (!frozen && !dryRun) {
      Logger.log("Đã chốt danh sách: " + freezeXmasPending_(pending) + " email — email thêm vào tab sau lúc này sẽ không được gửi.");
    }

    const startedAt = Date.now();
    let sent = 0, failed = 0, dup = 0;
    for (let i = 0; i < pending.length && sent < limit; i++) {
      if (Date.now() - startedAt > XMAS_MAX_RUN_MS) {
        Logger.log("Sắp hết thời gian chạy của Apps Script — dừng, phần còn lại gửi ở lần sau.");
        break;
      }
      const p = pending[i];
      const sentCell = list.sheet.getRange(p.rowNum, col["Sent"] + 1);

      if (sentEmails[p.email]) {
        Logger.log("Dòng " + p.rowNum + " " + p.email + ": trùng email đã gửi — bỏ qua.");
        if (!dryRun) { sentCell.setValue("SKIPPED: duplicate email"); SpreadsheetApp.flush(); }
        dup++;
        continue;
      }

      const name = p.firstName || "there";
      if (dryRun) {
        Logger.log("[XEM TRƯỚC] dòng " + p.rowNum + ": sẽ gửi cho " + name + " <" + p.email + ">");
        sentEmails[p.email] = true;
        sent++;
        continue;
      }

      try {
        sendXmasEmail_(p.email, name, assets);
        sentCell.setValue(Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm"));
        SpreadsheetApp.flush();
        sentEmails[p.email] = true;
        sent++;
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        if (/too many times|quota|limit exceeded/i.test(msg)) {
          Logger.log("Hết hạn mức email trong ngày — dừng: " + msg);
          break;
        }
        sentCell.setValue("ERROR: " + msg);
        SpreadsheetApp.flush();
        Logger.log("Dòng " + p.rowNum + " " + p.email + ": lỗi gửi — " + msg);
        failed++;
      }
    }

    const left = pending.length - sent - failed - dup;
    Logger.log((dryRun ? "[XEM TRƯỚC — chưa gửi gì] " : "[ĐÃ GỬI] ") +
      sent + " email, " + failed + " lỗi, " + dup + " trùng bỏ qua; còn lại chưa xử lý: " + left + ".");

    if (!dryRun && left === 0) {
      removeChristmasTriggers_();
      Logger.log("Đã gửi hết danh sách — đã xóa trigger hằng ngày.");
    }
  } finally {
    lock.releaseLock();
  }
}

// Đặt trigger chạy sendChristmasBatch mỗi ngày lúc 10h (giờ UK). Lần đầu nên
// bấm Run sendChristmasBatch bằng tay trong hôm nay (để cấp quyền Drive/Mail và
// gửi đợt đầu), trigger sẽ lo các ngày tiếp theo.
function setupChristmasTrigger() {
  removeChristmasTriggers_();
  ScriptApp.newTrigger("sendChristmasBatch")
    .timeBased()
    .everyDays(1)
    .atHour(10)
    .inTimezone(TIMEZONE)
    .create();
  Logger.log("Đã đặt trigger: sendChristmasBatch chạy mỗi ngày khoảng 10h (giờ UK).");
}

function removeChristmasTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendChristmasBatch") ScriptApp.deleteTrigger(t);
  });
}
