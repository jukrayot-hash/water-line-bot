import express from 'express';
import { GoogleGenAI } from "@google/genai";
import fetch from 'node-fetch'; // หรือใช้ fetch ในตัวของ Node.js 18+

const app = express();
app.use(express.json());

// ==========================================
// ⚙️ ส่วนตั้งค่า (นำ Token และ API Key ของคุณมาใส่ตรงนี้)
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

// กำหนด Client ของ Gemini
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/// ตัวแปรสำหรับเก็บรวบรวมรูปภาพชั่วคราว แยกตาม userId (ป้องกันส่งแยกข้อความ)
const userImageSessions = {};

// ==========================================
// 🔗 1. LINE Webhook Endpoint
// ==========================================
app.post('/webhook', async (req, res) => {
  try {
    const events = req.body.events;
    if (!events || events.length === 0) {
      return res.status(200).send("OK");
    }

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'image') {
        const replyToken = event.replyToken;
        const userId = event.source.userId;
        const messageId = event.message.id;

        console.log(`ได้รับรูปภาพ (Message ID: ${messageId}) จากผู้ใช้ ${userId}`);

        // 1. ดาวน์โหลดรูปภาพจาก LINE
        const imageBuffer = await getLineImage(messageId);

        // 2. จัดกลุ่มภาพตาม User เพื่อรอรวบรวม
        if (!userImageSessions[userId]) {
          userImageSessions[userId] = {
            images: [],
            replyTokens: [],
            timer: null
          };
        }

        userImageSessions[userId].images.push(imageBuffer);
        userImageSessions[userId].replyTokens.push(replyToken);

        // เคลียร์ Timer เก่า (ถ้ามี) แล้วตั้งเวลาใหม่ 3 วินาที เพื่อรอให้ผู้ใช้ส่งรูปให้ครบทุกรูป
        if (userImageSessions[userId].timer) {
          clearTimeout(userImageSessions[userId].timer);
        }

        userImageSessions[userId].timer = setTimeout(async () => {
          const session = userImageSessions[userId];
          delete userImageSessions[userId]; // ลบ Session ทิ้งหลังประมวลผล

          try {
            console.log(`กำลังประมวลผลรวบรวมรูปภาพทั้งหมด ${session.images.length} รูป...`);
            
            // ส่งรูปทั้งหมดไปวิเคราะห์พร้อมกันในครั้งเดียว
            const aiReport = await generateWaterReport(session.images);

            // ส่งผลลัพธ์กลับไปหาผู้ใช้ทาง LINE (ใช้ replyToken อันแรก)
            if (session.replyTokens.length > 0) {
              await replyLineMessage(session.replyTokens[0], aiReport);
            }
          } catch (err) {
            console.error("Aggregation Processing Error:", err);
            if (session.replyTokens.length > 0) {
              await replyLineMessage(session.replyTokens[0], "ขออภัย เกิดข้อผิดพลาดในการประมวลผลภาพรวม: " + err.message);
            }
          }
        }, 3000); // รอ 3 วินาทีเผื่อส่งหลายรูปติดกัน

      } else if (event.type === 'message' && event.message.type === 'text') {
        const userText = event.message.text;
        if (userText === 'สวัสดี' || userText === 'help') {
          await replyLineMessage(event.replyToken, "สวัสดีครับ! ส่งภาพถ่ายหน้าจอข้อมูลอุทกวิทยา (ลุ่มน้ำบางปะกง, ชายฝั่งทะเลตะวันออก, โตนเลสาบ) มาได้เลยครับ ส่งมาหลายรูปพร้อมกันได้ เดี๋ยวผมรวบรวมและสรุปเป็นรายงานฉบับเดียวให้ครับ");
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
// 🧠 ฟังก์ชันส่งภาพทั้งหมดให้ Gemini วิเคราะห์รอบเดียว (รวบรวมข้อมูล + Zero-hallucination)
// ==========================================
async function generateWaterReport(imageBuffers) {
  const now = new Date();
  const yearBE = now.getFullYear() + 543;
  const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const thaiDateStr = `วันที่ ${now.getDate()} ${months[now.getMonth()]} พ.ศ. ${yearBE}`;

  const systemPrompt = `คุณคือผู้เชี่ยวชาญด้านวิศวกรรมทรัพยากรน้ำและอุทกวิทยา หน้าที่ของคุณคือนำ "ภาพถ่ายหน้าจอข้อมูลสถานการณ์น้ำหรือปริมาณฝนสะสมทั้งหมด ${imageBuffers.length} รูป" ที่แนบมานี้ มาทำการรวบรวมข้อมูลทั้งหมดเข้าด้วยกัน แล้ววิเคราะห์เรียบเรียงเป็นรายงานสถานการณ์น้ำฉบับสมบูรณ์เพียงฉบับเดียว

⚠️ **กฎเหล็กสำคัญที่สุด (เคร่งครัดมาก):**
1. **ขอบเขตพื้นที่:** โครงการนี้อยู่ในเขต 3 ลุ่มน้ำภาคตะวันออกเท่านั้น ได้แก่ (1) ลุ่มน้ำบางปะกง (2) ลุ่มน้ำชายฝั่งทะเลตะวันออก และ (3) ลุ่มน้ำโตนเลสาบ ห้ามอ้างอิงพื้นที่อื่นเด็ดขาด
2. **อ่านข้อมูลจากรูปภาพทั้งหมดที่แนบมาเท่านั้น:** ให้รวบรวมและตรวจสอบตัวเลข สถานี พื้นที่ ระดับน้ำ ระดับตลิ่ง หรือปริมาณฝน (มม.) จากทุกรูปที่แนบมา ห้ามแต่งเติมหรือกุตัวเลขขึ้นมาเองเด็ดขาด (Zero-hallucination)
3. ในข้อความรายงาน **ต้องระบุตัวเลขวันที่อย่างชัดเจน คือ ${thaiDateStr}** เป็นภาษาไทยทั้งหมด และใช้คำว่า **"พ.ศ."** แทนการสะกดเต็ม
4. ใช้ภาษาไทยที่เป็นทางการ สละสลวย จัดรูปแบบหัวข้อและย่อหน้าให้อ่านง่าย

ใช้โครงสร้างรายงานตามรูปแบบนี้:

${thaiDateStr} สรุปภาพรวมสถานการณ์น้ำและปริมาณฝนในพื้นที่ 3 ลุ่มน้ำภาคตะวันออก (บางปะกง, ชายฝั่งทะเลตะวันออก, โตนเลสาบ) จากข้อมูลและภาพถ่ายหน้าจอทั้งหมดที่รวบรวมจากระบบอุทกวิทยา พบว่ามีหลายพื้นที่ได้รับอิทธิพลจากปริมาณฝนสะสม 24 ชั่วโมง โดยมีบางสถานีวัดปริมาณฝนสะสมในเกณฑ์สำคัญ ซึ่งส่งผลให้ระดับน้ำในลำน้ำบางแห่งมีแนวโน้มเปลี่ยนแปลงตามสภาพภูมิประเทศ

ด้านสถานการณ์ระดับน้ำในลำน้ำและปริมาณฝนสะสม (อิงจากภาพถ่ายทั้งหมดที่แนบมา)

* **สถานการณ์ระดับน้ำและจุดที่ล้นตลิ่ง:** 
  * [รวบรวมและระบุชื่อสถานี พื้นที่ และตัวเลขระดับน้ำ/ระดับตลิ่ง จากในภาพทั้งหมดเฉพาะ 3 ลุ่มน้ำที่กำหนด]
* **ปริมาณฝนสะสม 24 ชั่วโมง:** 
  * [รวบรวมและระบุชื่อสถานีและปริมาณฝนที่เป็นตัวเลข มม. จากในภาพทั้งหมด]
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

  // เรียงลำดับโมเดลที่ดีที่สุดและพร้อมใช้งานที่สุดขึ้นก่อน
  // กำหนดลำดับโมเดลสำรอง เพื่อป้องกันปัญหา 503 หรือ Quota เต็ม
  const candidateModels = ["gemini-3.8-flash", "gemini-3.1-pro-preview"];
  for (let m = 0; m < candidateModels.length; m++) {
    try {
      console.log(`กำลังเรียกใช้งานโมเดล: ${candidateModels[m]}...`);
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

  throw new Error("เซิร์ฟเวอร์ AI ไม่สามารถประมวลผลภาพได้ทั้งหมด (โปรดตรวจสอบโควต้า API Key อีกครั้ง)");
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