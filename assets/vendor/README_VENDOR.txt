Đặt thư viện offline thật tại thư mục này.

1) jsQR.min.js
- Cần cho Safari/Edge cũ không hỗ trợ BarcodeDetector.
- Nếu không đặt file thật, app sẽ thử server fallback qr_decode_api.php.

2) tesseract.min.js + worker/wasm/lang-data
- Cần cho OCR chạy trực tiếp trong browser.
- Nếu không đặt file thật, app sẽ fallback qua ocr_api.php dùng Tesseract OCR local trên server.

Không dùng CDN/internet trong project.
