const admin = require('firebase-admin');

// Khởi tạo Firebase Admin bằng các biến môi trường trên Vercel
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel đôi khi làm hỏng chuỗi \n, hàm replace này sẽ fix lỗi đó
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  // Cấu hình CORS để SePay có thể bắn API vào
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Chỉ nhận POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const sepayToken = process.env.SEPAY_TOKEN;
    const authHeader = req.headers['authorization'];
    
    // Kiểm tra bảo mật
    if (!authHeader || authHeader !== `Bearer ${sepayToken}`) {
        return res.status(401).json({ error: 'Sai Token bảo mật!' });
    }

    const data = req.body;
    // SePay gửi số tiền qua transferAmount và nội dung qua content
    const amount = parseInt(data.transferAmount || data.amount || 0);
    const content = (data.content || data.description || "").toUpperCase();

    // Tìm mã User từ nội dung (Ví dụ: NAPXU A1B2C3)
    if (content.includes('NAPXU')) {
        const parts = content.split('NAPXU');
        const userCode = parts[1].trim().substring(0, 6); 

        // Tìm User trong Firestore
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('userCode', '==', userCode).get();

        if (snapshot.empty) {
            console.log(`Lỗi: Không tìm thấy tài khoản với mã ${userCode}`);
            return res.status(200).json({ error: 'Không tìm thấy tài khoản' });
        }

        // Cộng Xu vào Database
        const userDoc = snapshot.docs[0];
        const currentBalance = userDoc.data().balance || 0;
        
        await userDoc.ref.update({
            balance: currentBalance + amount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Ghi lại lịch sử nạp tiền
        await db.collection('transactions').add({
            userId: userDoc.id,
            userCode: userCode,
            amount: amount,
            type: 'deposit',
            sepayTxnId: data.id || 'unknown',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[THÀNH CÔNG] Đã cộng ${amount} Xu cho mã ${userCode}`);
        return res.status(200).json({ success: true, message: 'Đã cộng Xu thành công' });
    }

    return res.status(200).json({ success: true, message: 'Nội dung không hợp lệ (Không có chữ NAPXU)' });

  } catch (error) {
    console.error("Lỗi Server:", error);
    return res.status(500).json({ error: 'Lỗi nội bộ Server' });
  }
}
