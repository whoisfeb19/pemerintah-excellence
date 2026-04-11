// File: config.js

// PENTING: Gunakan window. agar variabel bisa diakses oleh file HTML lain
window.CONFIG = {
    DAFTAR_GAJI: {
        "GUBERUR": 150000,
        "WAKIL GUBERNUR": 140000,
        "SEKRETARIS": 120000,
        "KEPALA DIVISI": 100000,
        "STAFF SENIOR": 80000,
        "STAFF JUNIOR": 50000,
        "STAFF MAGANG": 25000,
        "UNKNOWN": 0
    },
    TARGET_HADIR: 6,
    TARGET_FULL_GAJI: 5,
    BONUS_RAJIN: 10000 
};

// Tambahkan variabel ini untuk memperbaiki error "RANK_ORDER is not defined"
window.RANK_ORDER = {
    "GUBERUR": 1,
    "WAKIL GUBERNUR": 2,
    "SEKRETARIS": 3,
    "KEPALA DIVISI": 4,
    "STAFF SENIOR": 5,
    "STAFF JUNIOR": 6,
    "STAFF MAGANG": 7
};

window.hitungGajiMember = function(pangkat, jumlahHariHadir) {
    const rankCek = pangkat ? pangkat.toUpperCase().trim() : "UNKNOWN";
    const gajiPokok = window.CONFIG.DAFTAR_GAJI[rankCek] || 0;
    
    let hadirValid = Math.min(jumlahHariHadir, window.CONFIG.TARGET_HADIR);
    let totalGaji = 0;
    let totalPotongan = 0;
    let alpa = window.CONFIG.TARGET_HADIR - hadirValid;

    if (hadirValid >= window.CONFIG.TARGET_FULL_GAJI) {
        totalGaji = gajiPokok;
    } else {
        const kekurangan = window.CONFIG.TARGET_FULL_GAJI - hadirValid;
        const potonganPerHari = gajiPokok / window.CONFIG.TARGET_FULL_GAJI;
        totalPotongan = kekurangan * potonganPerHari;
        totalGaji = gajiPokok - totalPotongan;
    }

    if (hadirValid >= window.CONFIG.TARGET_HADIR) {
        totalGaji += window.CONFIG.BONUS_RAJIN;
    }

    return {
        gajiPokok,
        alpa,
        totalPotongan: Math.floor(totalPotongan),
        gajiAkhir: Math.floor(totalGaji < 0 ? 0 : totalGaji)
    };
}
