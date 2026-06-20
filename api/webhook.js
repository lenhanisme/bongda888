const admin = require('firebase-admin');

// Khởi tạo Firebase Admin (Quyền cao nhất để can thiệp Database)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Fix lỗi xuống dòng của private key trên Vercel
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  // Chỉ nhận tín hiệu POST từ SePay
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // 1. Kiểm tra Token bảo mật (Ngăn hacker gọi láo API cộng tiền)
    const sepayToken = process.env.SEPAY_TOKEN; // Cài trên Vercel
    const authHeader = req.headers['authorization'];
    
    if (!authHeader || authHeader !== `Bearer ${sepayToken}`) {
        return res.status(401).json({ error: 'Sai Token bảo mật!' });
    }

    // 2. Lấy dữ liệu SePay gửi về
    const { transferAmount, content } = req.body;
    const amount = parseInt(transferAmount);
    const upperContent = content.toUpperCase();

    // 3. Tìm mã User trong nội dung (Ví dụ chuyển khoản: "NAPXU 1A2B3C")
    if (upperContent.includes('NAPXU')) {
        // Cắt lấy 6 ký tự phía sau chữ NAPXU
        const userCode = upperContent.split('NAPXU')[1].trim().substring(0, 6); 

        // 4. Tìm tài khoản trong Firebase Firestore
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('userCode', '==', userCode).get();

        if (snapshot.empty) {
            console.log(`Lỗi: Người dùng chuyển khoản sai mã (${userCode})`);
            return res.status(200).json({ error: 'Không tìm thấy mã tài khoản' });
        }

        // 5. Cộng tiền vào Database
        const userDoc = snapshot.docs[0];
        const currentBalance = userDoc.data().balance || 0;
        
        await userDoc.ref.update({
            balance: currentBalance + amount
        });

        console.log(`[THÀNH CÔNG] Đã nạp ${amount} Xu cho mã ${userCode}`);
        return res.status(200).json({ success: true, message: 'Đã cộng tiền' });
    }

    return res.status(200).json({ success: true, message: 'Nội dung không có chữ NAPXU' });

  } catch (error) {
    console.error("Lỗi Server:", error);
    return res.status(500).json({ error: 'Lỗi nội bộ' });
  }
}
