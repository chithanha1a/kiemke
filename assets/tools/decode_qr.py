import sys, json
try:
    import cv2
except Exception as e:
    print(json.dumps({"text":"", "error":"cv2 not available"}))
    sys.exit(2)
path = sys.argv[1] if len(sys.argv) > 1 else ''
img = cv2.imread(path)
if img is None:
    print(json.dumps({"text":""}))
    sys.exit(1)
detector = cv2.QRCodeDetector()
variants = []
variants.append(img)
for code in [cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE]:
    variants.append(cv2.rotate(img, code))
for im in list(variants):
    try:
        gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        variants.append(gray)
        _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(th)
    except Exception:
        pass
for im in variants:
    try:
        data, pts, _ = detector.detectAndDecode(im)
        if data:
            print(json.dumps({"text": data}, ensure_ascii=False))
            sys.exit(0)
    except Exception:
        pass
print(json.dumps({"text":""}))
sys.exit(1)
