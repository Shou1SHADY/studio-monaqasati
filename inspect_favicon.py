import struct

def get_image_info(data):
    # Check for JPEG signature
    if data[:4] == b'\xff\xd8\xff\xe0' or data[:4] == b'\xff\xd8\xff\xe1':
        # JPEG parsing
        size = len(data)
        i = 4
        while i < size:
            # Check marker
            if data[i] == 0xFF:
                # Find non-FF byte
                while i < size and data[i] == 0xFF:
                    i += 1
                if i >= size:
                    break
                marker = data[i]
                i += 1
                if marker in [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]:
                    # SOF marker contains height and width
                    # Length (2 bytes), Precision (1 byte), Height (2 bytes), Width (2 bytes)
                    length = struct.unpack('>H', data[i:i+2])[0]
                    height, width = struct.unpack('>HH', data[i+3:i+7])
                    return "JPEG", width, height
                else:
                    length = struct.unpack('>H', data[i:i+2])[0]
                    i += length
            else:
                i += 1
    return "Unknown", 0, 0

try:
    with open('public/logofavicon.jpg', 'rb') as f:
        data = f.read(10000) # Read enough bytes to get dimensions
        fmt, w, h = get_image_info(data)
        print(f"Format: {fmt}, Width: {w}, Height: {h}")
except Exception as e:
    print("Error:", e)
