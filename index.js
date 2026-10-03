import express from 'express';
import { GoogleGenAI } from "@google/genai";
import fetch from 'node-fetch'; // หรือใช้ fetch ในตัวของ Node.js 18+

const app = express();
app.use(express.json());

// ==========================================
// ⚙️ ส่วนตั้งค่า (นำ Token และ API Key ของคุณมาใส่ตรงนี้)
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "ใส่_GEMINI_API_KEY_ของคุณที่นี่";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN || "ใส่_LINE_ACCESS_TOKEN_ของคุณที่นี่";

// กำหนด Client ของ Gemini
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ==========================================
// 🔗 1. LINE Webhook Endpoint (จุดรับข้อความและรูปจาก LINE)
// ==========================================
app.post('/webhook', async (req, res) => {
  try {
    const events = req.body.events;
    if (!events || events.length === 0) {
      return res.status(200).send("OK");
    }

    for (const event of events) {
      // ตรวจสอบว่าเป็นข้อความหรือรูปภาพที่ส่งเข้ามา
      if (event.type === 'message') {
        const replyToken = event.replyToken;
        const userId = event.source.userId;

        // กรณีส่งรูปภาพเข้ามา
        if (event.message.type === 'image') {
          const messageId = event.message.id;
          console.log(`ได้รับรูปภาพ (Message ID: ${messageId}) กำลังดาวน์โหลด...`);

          // 1. ดึงไฟล์รูปภาพจาก LINE Servers
          const imageBuffer = await getLineImage(messageId);

          // 2. ส่งรูปให้ Gemini วิเคราะห์ตามเงื่อนไข 3 ลุ่มน้ำ
          console.log("กำลังส่งภาพให้ Gemini วิเคราะห์...");
          const aiReport = await generateWaterReport([imageBuffer]);

          // 3. ส่งรายงานกลับไปหาผู้ใช้ทาง LINE
          await replyLineMessage(replyToken, aiReport);
        }
        // กรณีพิมพ์ข้อความธรรมดา
        else if (event.message.type === 'text') {
          const userText = event.message.text;
          if (userText === 'สวัสดี' || userText === 'help') {
            await replyLineMessage(replyToken, "สวัสดีครับ! ส่งภาพถ่ายหน้าจอข้อมูลอุทกวิทยา (ลุ่มน้ำบางปะกง, ชายฝั่งทะเลตะวันออก, โตนเลสาบ) มาได้เลยครับ เดี๋ยวผมช่วยสรุปรายงานให้");
          }
        }
      }
    }

    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 📥 ฟังก์ชันดาวน์โหลดรูปภาพจาก LINE API
// ==========================================
async function getLineImage(messageId) {
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
    }
  });

  if (!response.ok) {
    throw new Error(`ไม่สามารถดาวน์โหลดรูปภาพจาก LINE ได้: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ==========================================
// 🧠 ฟังก์ชันส่งภาพให้ Gemini วิเคราะห์ (Zero-hallucination & 3 ลุ่มน้ำ)
// ==========================================
async function generateWaterReport(imageBuffers) {
  const now = new Date();
  const yearBE = now.getFullYear() + 543;
  const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const thaiDateStr = `วันที่ ${now.getDate()} ${months[now.getMonth()]} พ.ศ. ${yearBE}`;

  const systemPrompt = `คุณคือผู้เชี่ยวชาญด้านวิศวกรรมทรัพยากรน้ำและอุทกวิทยา หน้าที่ของคุณคือนำ "ภาพถ่ายหน้าจอข้อมูลสถานการณ์น้ำหรือปริมาณฝนสะสม" ที่แนบมา มาทำการวิเคราะห์และเรียบเรียงเป็นรายงานสถานการณ์น้ำอย่างละเอียด

⚠️ **กฎเหล็กสำคัญที่สุด (เคร่งครัดมาก):**
1. **ขอบเขตพื้นที่:** โครงการนี้อยู่ในเขต 3 ลุ่มน้ำภาคตะวันออกเท่านั้น ได้แก่ (1) ลุ่มน้ำบางปะกง (2) ลุ่มน้ำชายฝั่งทะเลตะวันออก และ (3) ลุ่มน้ำโตนเลสาบ ห้ามอ้างอิงพื้นที่อื่นเด็ดขาด
2. **อ่านข้อมูลจากรูปภาพที่แนบมาเท่านั้น:** ให้ตรวจสอบตัวเลข สถานี พื้นที่ ระดับน้ำ ระดับตลิ่ง หรือปริมาณฝน (มม.) ที่ปรากฏอยู่ในรูปภาพจริง ห้ามแต่งเติมหรือกุตัวเลขขึ้นมาเองเด็ดขาด (Zero-hallucination)
3. ในข้อความรายงาน **ต้องระบุตัวเลขวันที่อย่างชัดเจน คือ ${thaiDateStr}** เป็นภาษาไทยทั้งหมด และใช้คำว่า **"พ.ศ."** แทนการสะกดเต็ม
4. ใช้ภาษาไทยที่เป็นทางการ สละสลวย จัดรูปแบบหัวข้อและย่อหน้าให้อ่านง่าย

ใช้โครงสร้างรายงานตามรูปแบบนี้:

${thaiDateStr} สรุปภาพรวมสถานการณ์น้ำและปริมาณฝนในพื้นที่ 3 ลุ่มน้ำภาคตะวันออก (บางปะกง, ชายฝั่งทะเลตะวันออก, โตนเลสาบ) จากข้อมูลและภาพถ่ายหน้าจอที่รวบรวมจากระบบอุทกวิทยา พบว่ามีหลายพื้นที่ได้รับอิทธิพลจากปริมาณฝนสะสม 24 ชั่วโมง โดยมีบางสถานีวัดปริมาณฝนสะสมในเกณฑ์สำคัญ ซึ่งส่งผลให้ระดับน้ำในลำน้ำบางแห่งมีแนวโน้มเปลี่ยนแปลงตามสภาพภูมิประเทศ

ด้านสถานการณ์ระดับน้ำในลำน้ำและปริมาณฝนสะสม (อิงจากภาพถ่ายที่แนบมา)

* **สถานการณ์ระดับน้ำและจุดที่ล้นตลิ่ง:** 
  * [ระบุชื่อสถานี พื้นที่ และตัวเลขระดับน้ำ/ระดับตลิ่ง จากในภาพจริงเฉพาะ 3 ลุ่มน้ำที่กำหนด]
* **ปริมาณฝนสะสม 24 ชั่วโมง:** 
  * [ระบุชื่อสถานีและปริมาณฝนที่เป็นตัวเลข มม. จากในภาพจริง]
* **แนวโน้มระดับน้ำและการคาดการณ์ล่วงหน้า 3 วัน (จาก Thaiwater):** 
  * ระดับน้ำในปัจจุบันของสถานีส่วนใหญ่มีแนวโน้มทรงตัวและเปลี่ยนแปลงตามปริมาณฝนที่ตกลงมาในพื้นที่ 
  * สำหรับการคาดการณ์ล่วงหน้า 3 วันข้างหน้า หากยังมีฝนตกสะสมต่อเนื่องในพื้นที่ จะส่งผลให้ระดับน้ำในลำน้ำยังคงทรงตัวในเกณฑ์สูงหรือต้องเฝ้าระวังในจุดเสี่ยงเดิม

บทสรุปการบริหารจัดการน้ำและแนวทางการปฏิบัติงานในพื้นที่สำหรับเจ้าหน้าที่ เน้นย้ำให้หน่วยงานและเจ้าหน้าที่ผู้ปฏิบัติงานในพื้นที่ติดตามสถานการณ์น้ำและปริมาณฝนสะสมอย่างใกล้ชิด พร้อมทั้งตรวจสอบความพร้อมของเครื่องมือ อุปกรณ์ระบายน้ำ และระบบเตือนภัยให้พร้อมใช้งาน เพื่อให้สามารถแจ้งเตือนประชาชนในพื้นที่เสี่ยงภัยริมลำน้ำได้อย่างทันท่วงที`;

  let contentsArray = [systemPrompt];
  for (let i = 0; i < imageBuffers.length; i++) {
    contentsArray.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: imageBuffers[i].toString("base64")
      }
    });
  }

  const candidateModels = ["gemini-3.8-flash", "gemini-3.1-pro-preview","gemini-3.5-flash","gemini-2.5-flash", "gemini-1.5-flash",];
  for (let m = 0; m < candidateModels.length; m++) {
    try {
      const response = await ai.models.generateContent({
        model: candidateModels[m],
        contents: contentsArray,
      });

      if (response && response.text) {
        return response.text;
      }
    } catch (e) {
      console.error(`Model ${candidateModels[m]} error:`, e.message);
    }
  }

  throw new Error("เซิร์ฟเวอร์ AI ไม่สามารถประมวลผลภาพได้");
}

// ==========================================
// 💬 ฟังก์ชันตอบกลับข้อความทาง LINE
// ==========================================
async function replyLineMessage(replyToken, message) {
  const url = "https://api.line.me/v2/bot/message/reply";
  await fetch(url, {
    method: "post",
    headers: {
      "Authorization": "Bearer " + LINE_CHANNEL_ACCESS_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: "text", text: message }]
    })
  });
}

// ==========================================
// 🚀 เริ่มต้นรันเซิร์ฟเวอร์
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LINE Bot Server is running on port ${PORT}`);
});
