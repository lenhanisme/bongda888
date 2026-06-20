const admin = require('firebase-admin');

// 1. KHỞI TẠO FIREBASE ADMIN (ĐỂ KẾT NỐI VÀO FIRESTORE)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Fix lỗi Vercel làm hỏng dấu xuống dòng của Private Key
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

const db = admin.firestore();

// 2. ENDPOINT NHẬN WEBHOOK TỪ SEPAY
export default async function handler(req, res) {
  // Cấu hình CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Bắt buộc phương thức POST như tài liệu yêu cầu
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Chỉ chấp nhận POST request' });
  }

  try {
    // [TÙY CHỌN BẢO MẬT] Kiểm tra API Key (Nếu bạn có bật trong tab Bảo mật của SePay)
    const sepayToken = process.env.SEPAY_TOKEN;
    if (sepayToken) {
       const authHeader = req.headers['authorization'];
       if (!authHeader || authHeader !== `Bearer ${sepayToken}`) {
           return res.status(401).json({ success: false, message: 'Sai Token bảo mật!' });
       }
    }

    // 3. NHẬN PAYLOAD TỪ SEPAY
    const payload = req.body;
    const transactionId = payload.id; // ID duy nhất của giao dịch
    const transferType = payload.transferType; // 'in' hoặc 'out'
    const transferAmount = parseInt(payload.transferAmount || 0); // Số tiền
    const content = (payload.content || "").toUpperCase(); // Nội dung chuyển khoản

    // Loại bỏ giao dịch tiền ra (chỉ xử lý tiền vào)
    if (transferType !== 'in') {
        return res.status(200).json({ success: true, message: 'Bỏ qua giao dịch tiền ra' });
    }

    // 4. KIỂM TRA CHỐNG TRÙNG LẶP (IDEMPOTENCY) THEO CHUẨN SEPAY
    const txnRef = db.collection('transactions').where('sepayTxnId', '==', transactionId);
    const txnSnapshot = await txnRef.get();
    
    if (!txnSnapshot.empty) {
        // Giao dịch này đã được xử lý rồi, trả về 200 để SePay không gửi nữa
        return res.status(200).json({ success: true, message: 'Giao dịch đã được xử lý trước đó' });
    }

    // 5. XỬ LÝ CÚ PHÁP (VD: "NAPXU A1B2C3")
    if (content.includes('NAPXU')) {
        const parts = content.split('NAPXU');
        // Lấy đúng 6 ký tự mã sau chữ NAPXU
        const userCode = parts[1].trim().substring(0, 6); 

        // Tìm User trong Firestore
        const usersRef = db.collection('users');
        const userSnapshot = await usersRef.where('userCode', '==', userCode).get();

        if (userSnapshot.empty) {
            console.log(`Lỗi: Chuyển khoản sai mã người dùng (${userCode})`);
            // Trả về 200 để SePay ghi nhận thành công, nhưng ta không cộng tiền
            return res.status(200).json({ success: true, message: 'Không tìm thấy tài khoản để cộng tiền' });
        }

        // Cộng Xu vào Database
        const userDoc = userSnapshot.docs[0];
        const currentBalance = userDoc.data().balance || 0;
        
        await userDoc.ref.update({
            balance: currentBalance + transferAmount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 6. GHI LẠI BIÊN LAI VÀO DATABASE
        await db.collection('transactions').add({
            userId: userDoc.id,
            userCode: userCode,
            amount: transferAmount,
            type: 'deposit',
            sepayTxnId: transactionId, // Lưu ID của SePay để chống trùng lặp sau này
            rawContent: content,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[THÀNH CÔNG] Đã cộng ${transferAmount} Xu cho mã ${userCode}`);
        return res.status(200).json({ success: true, message: 'Đã cộng Xu thành công' });
    }

    // Trả về 200 OK cho nội dung không hợp lệ để kết thúc chu trình của SePay
    return res.status(200).json({ success: true, message: 'Giao dịch không chứa từ khóa NAPXU' });

  } catch (error) {
    console.error("Lỗi nội bộ Server:", error);
    // Nếu có lỗi hệ thống, trả về 500 để tính năng "Tự động gửi lại" của SePay hoạt động
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
}
