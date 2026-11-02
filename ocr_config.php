<?php
// Cấu hình OCR local cho Windows Server.
// Nếu server của bạn cài Tesseract ở đường dẫn khác, chỉnh 2 dòng dưới.
$TESSERACT_EXE = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
$TESSDATA_PREFIX = 'C:\\Program Files\\Tesseract-OCR\\tessdata';

// Với mã thiết bị/asset card nên ưu tiên eng để giảm nhiễu tiếng Việt.
// Nếu cần tiếng Việt, đổi thành 'eng+vie' và đảm bảo có vie.traineddata trong tessdata.
$OCR_LANG = 'eng';
$OCR_PSM = 11;
