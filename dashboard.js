
    const _supabase = window.supabase.createClient("https://knldblqwaumehhwaodmn.supabase.co", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtubGRibHF3YXVtZWhod2FvZG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4OTIwNzIsImV4cCI6MjA5MTQ2ODA3Mn0.EdMpVA8E4Vax8FCwJcKAJx-f-d80ysGWRsGLSAS_q3I");

    window.onload = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const discordId = urlParams.get('id');
        const name = urlParams.get('name');
        const rank = urlParams.get('pangkat');
        const divisi = urlParams.get('divisi');
        const isAdmin = urlParams.get('admin') === 'true';

        // Logika Sinkronisasi Data Saat Login/Buka Link Baru
        if (discordId && name) {
            localStorage.setItem("discord_id", discordId);
            localStorage.setItem("nama_user", decodeURIComponent(name));
            localStorage.setItem("pangkat", decodeURIComponent(rank || "Unknown"));
            localStorage.setItem("divisi", decodeURIComponent(divisi || "-"));
            localStorage.setItem("is_admin", isAdmin);

            // Update users_master agar data database selalu match dengan Discord saat login
            await _supabase.from('users_master').upsert({
                discord_id: discordId,
                nama_anggota: decodeURIComponent(name),
                pangkat: decodeURIComponent(rank || "Unknown"),
                divisi: decodeURIComponent(divisi || "-")
            }, { onConflict: 'discord_id' });

            window.history.replaceState({}, document.title, window.location.pathname);
        }

        if (!localStorage.getItem("discord_id")) { 
            window.location.href = "index.html"; 
            return;
        }

        updateUI();
        toggleFormMode();
        updateGajiDisplay(); 
    };

    function updateUI() {
        document.getElementById('name-display').innerText = localStorage.getItem("nama_user");
        document.getElementById('rank-display').innerText = `${localStorage.getItem("pangkat")} | ${localStorage.getItem("divisi")}`;
        if (localStorage.getItem("is_admin") === "true") {
            document.getElementById('admin-link').style.display = 'block';
        }
    }

    async function updateGajiDisplay() {
    const discId = localStorage.getItem("discord_id");
    const pangkat = localStorage.getItem("pangkat");
    
    // Hitung awal minggu (Senin)
    const d = new Date();
    const day = d.getDay(), diff = d.getDate() - day + (day == 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);

    try {
        // Ambil data dari awal minggu sampai sekarang
        const { data: logs } = await _supabase
            .from('absensi_sasg')
            .select('jam_duty, created_at')
            .eq('discord_id', discId)
            .gte('created_at', monday.toISOString());
        
        // Gunakan Set untuk memastikan hanya 1 kali hadir yang dihitung per tanggal
        const hariHadirUnik = new Set();
        const hariIzinUnik = new Set();
        const hariCutiUnik = new Set();

        if (logs) {
            logs.forEach(l => {
                // Ambil format tanggal saja (YYYY-MM-DD) sebagai kunci unik
                const tanggalHanya = new Date(l.created_at).toISOString().split('T')[0];
                const ket = (l.jam_duty || "").toUpperCase();

                if (ket.includes("IZIN")) {
                    hariIzinUnik.add(tanggalHanya);
                } else if (ket.includes("CUTI")) {
                    hariCutiUnik.add(tanggalHanya);
                } else {
                    // Jika statusnya adalah waktu (jam duty), masukkan ke hadir
                    hariHadirUnik.add(tanggalHanya);
                }
            });
        }

        // Ambil jumlah hari unik (ukuran dari Set)
        const h = hariHadirUnik.size;
        const i = hariIzinUnik.size;
        const c = hariCutiUnik.size;

        // Hitung Alpa (Maksimal 6 hari kerja Senin-Sabtu)
        const totalInput = h + i + c;
        let a = Math.max(0, 6 - totalInput);

        // PANGGIL FUNGSI GLOBAL DARI config.js
        // Pastikan config.js sudah dimuat di atas script ini
        const hasil = hitungGajiMember(pangkat, h);
        
        // Update Tampilan UI
        document.getElementById('gaji-val').innerText = `$${hasil.gajiAkhir.toLocaleString()}`;
        document.getElementById('stat-hadir').innerText = h;
        document.getElementById('stat-izin').innerText = i;
        document.getElementById('stat-cuti').innerText = c;
        document.getElementById('stat-alpa').innerText = a;

    } catch (err) { 
        console.error("Gagal update stats:", err); 
    }
}

    function toggleFormMode() {
        const status = document.getElementById('status_absen').value;
        const today = new Date().toLocaleDateString('en-CA'); 
        
        const hadirSec = document.getElementById('hadir-section');
        const singleSec = document.getElementById('single-date-section');
        const rangeSec = document.getElementById('range-date-section');
        const fileInput = document.getElementById('bukti_foto');
        const tglInput = document.getElementById('tanggal_absen');
        const cutiMulai = document.getElementById('cuti_mulai');
        const cutiSelesai = document.getElementById('cuti_selesai');

        tglInput.value = ""; cutiMulai.value = ""; cutiSelesai.value = "";
        tglInput.removeAttribute('min'); tglInput.removeAttribute('max');
        cutiMulai.removeAttribute('min'); cutiSelesai.removeAttribute('min');

        if (status === "HADIR") {
            singleSec.style.display = "block"; rangeSec.style.display = "none"; hadirSec.style.display = "block";
            tglInput.max = today; tglInput.required = true; fileInput.required = true;
        } else if (status === "IZIN") {
            singleSec.style.display = "block"; rangeSec.style.display = "none"; hadirSec.style.display = "none";
            tglInput.min = today; tglInput.required = true; fileInput.required = false;
        } else if (status === "CUTI") {
            singleSec.style.display = "none"; rangeSec.style.display = "block"; hadirSec.style.display = "none";
            cutiMulai.min = today; cutiSelesai.min = today;
            tglInput.required = false; cutiMulai.required = true; cutiSelesai.required = true; fileInput.required = false;
        }
    }

    function logout() { 
        if (confirm("Logout dan hapus sesi?")) {
            localStorage.clear();
            window.location.href = "index.html"; 
        }
    }

    document.getElementById('absensi-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-submit');
        const msg = document.getElementById('status-msg');
        const statusAbsen = document.getElementById('status_absen').value;
        const discordId = localStorage.getItem("discord_id");
        
        btn.disabled = true;
        btn.innerText = "Memverifikasi...";

        try {
            // SINKRONISASI DATA TERBARU SEBELUM KIRIM (PENTING)
            // Ini mengambil data dari profil yang mungkin berubah di dashboard admin/discord
            const currentName = localStorage.getItem("nama_user");
            const currentRank = localStorage.getItem("pangkat");
            const currentDiv = localStorage.getItem("divisi");

            let dateList = [];
            if (statusAbsen === "CUTI") {
                let dStart = new Date(document.getElementById('cuti_mulai').value);
                let dEnd = new Date(document.getElementById('cuti_selesai').value);
                if (dEnd < dStart) throw new Error("Tanggal selesai tidak valid.");
                for (let d = new Date(dStart); d <= dEnd; d.setDate(d.getDate() + 1)) {
                    if (d.getDay() !== 0) dateList.push(new Date(d));
                }
            } else {
                let tglVal = new Date(document.getElementById('tanggal_absen').value);
                if (tglVal.getDay() === 0) throw new Error("Hari Minggu libur!");
                dateList.push(tglVal);
            }

            if (dateList.length === 0) throw new Error("Pilih tanggal valid.");

            let imgUrl = "N/A";
            const file = document.getElementById('bukti_foto').files[0];
            if (statusAbsen === "HADIR" && file) {
                btn.innerText = "Mengunggah Foto...";
                const path = `absensi/${Date.now()}_${discordId}.png`;
                await _supabase.storage.from('bukti-absen').upload(path, file);
                imgUrl = _supabase.storage.from('bukti-absen').getPublicUrl(path).data.publicUrl;
            }

            btn.innerText = "Mengirim...";
            const reports = dateList.map(d => ({
                discord_id: discordId,
                nama_anggota: currentName, // Gunakan nama terbaru
                pangkat: currentRank,      // Gunakan pangkat terbaru
                divisi: currentDiv,        // Gunakan divisi terbaru
                jam_duty: (statusAbsen === "HADIR") ? `${document.getElementById('jam_mulai').value} - ${document.getElementById('jam_selesai').value}` : statusAbsen,
                kegiatan: document.getElementById('kegiatan').value,
                bukti_foto: imgUrl,
                created_at: d.toISOString()
            }));

            const response = await fetch('/.netlify/functions/submit-absensi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reports)
            });

            const result = await response.json();
            if (response.status === 403) {
                alert("AKSES DICABUT!");
                localStorage.clear();
                window.location.href = "index.html";
                return;
            }

            if (response.status !== 200) throw new Error(result.message);

            // UPDATE UI DENGAN DATA TERBARU DARI DATABASE SETELAH ABSEN
            if (result.updatedData) {
                localStorage.setItem("nama_user", result.updatedData.name || currentName);
                localStorage.setItem("pangkat", result.updatedData.pangkat || currentRank);
                localStorage.setItem("divisi", result.updatedData.divisi || currentDiv);
                updateUI();
            }

            msg.innerText = "✔ Berhasil dikirim!";
            msg.style.color = "#2ecc71";
            document.getElementById('absensi-form').reset();
            toggleFormMode();
            updateGajiDisplay();

        } catch (err) {
            msg.innerText = "❌ " + err.message;
            msg.style.color = "#e94560";
        } finally {
            btn.disabled = false;
            btn.innerText = "Kirim Laporan";
        }
    });

