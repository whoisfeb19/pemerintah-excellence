exports.handler = async (event) => {
  const LOG_WEBHOOK = process.env.WARNING_WEBHOOK;
  const TOTAL_WEBHOOK = process.env.TOTAL_WARNING_WEBHOOK;
  const MESSAGE_ID = process.env.WARNING_MESSAGE_ID; 

  console.log("--- DEBUG START ---");
  const body = JSON.parse(event.body);

  try {
    // 1. Kirim Log Warning (Harusnya muncul di channel Log)
    await fetch(LOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.payload)
    });

    // 2. Logika untuk Channel Total Warning
    if (body.updateList) {
        if (MESSAGE_ID && MESSAGE_ID.trim() !== "") {
            // JIKA ADA ID -> EDIT
            console.log("Mencoba EDIT pesan ID:", MESSAGE_ID);
            const res = await fetch(`${TOTAL_WEBHOOK}/messages/${MESSAGE_ID}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: body.updateList })
            });
            console.log("Hasil Edit:", res.status, res.statusText);
        } else {
            // JIKA ID KOSONG -> KIRIM PESAN BARU
            console.log("ID Kosong, mencoba KIRIM PESAN BARU ke Total Warning...");
            const res = await fetch(TOTAL_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: body.updateList })
            });
            console.log("Hasil Kirim Baru:", res.status, res.statusText);
        }
    }

    return { statusCode: 200, body: "Check log Netlify!" };
  } catch (err) {
    console.error("CRASH TERJADI:", err.message);
    return { statusCode: 500, body: err.message };
  }
};
