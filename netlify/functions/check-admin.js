const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { discordId } = JSON.parse(event.body);
    const ADMIN_ROLE_ID = "1492400977012068363"; // Ganti dengan ID Role Admin kamu

    try {
        // 1. Ambil data member langsung dari Discord API
        const memberRes = await axios.get(
            `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordId}`,
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );

        const { roles } = memberRes.data;
        const freshIsAdmin = roles.includes(ADMIN_ROLE_ID);

        // 2. Update status di Database agar sinkron
        await supabase.from('users_master')
            .update({ is_admin: freshIsAdmin })
            .eq('discord_id', discordId);

        if (!freshIsAdmin) {
            return { 
                statusCode: 403, 
                body: JSON.stringify({ message: "Bukan Admin", isAdmin: false }) 
            };
        }

        return { 
            statusCode: 200, 
            body: JSON.stringify({ message: "Authorized", isAdmin: true }) 
        };

    } catch (err) {
        // Jika user tidak ditemukan di discord (sudah keluar/dikick)
        if (err.response && err.response.status === 404) {
            await supabase.from('users_master').delete().eq('discord_id', discordId);
            return { statusCode: 403, body: JSON.stringify({ message: "KICKED" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ message: "Error", error: err.message }) };
    }
};