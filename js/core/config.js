// @ts-check
// Seluruh parameter prototipe SI-TANGGAP dalam satu tempat.
// Angka, lokasi SPBU, dan nomor polisi adalah DATA SIMULASI, bukan data operasional.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  ns.config = {
    seed: 20261,
    tickHours: 0.25, // data masuk ke server tiap 15 menit (dokumen alur sistem, bagian 2)
    dayNames: ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"],

    // Ambang matriks keputusan (dokumen alur sistem, bagian 4.1 dan legenda wireframe)
    ews: {
      rNormal: 1.5,
      rKrisis: 1,
      consumptionWaspada: 1.2,
      criticalShareKrisis: 0.3,
      stockSafeHours: 24,
      stockCriticalHours: 6,
      recoveryHoldHours: 24, // asumsi: status baru turun setelah membaik satu siklus harian penuh (24 jam)
    },
    slaHours: { WASPADA: 6, KRISIS: 24 },

    recommendations: {
      WASPADA: [
        {
          id: "info-resmi",
          label: "Info resmi ke publik (stok & jadwal pasokan)",
          pj: "Pemda & Pertamina, satu sumber",
        },
        {
          id: "siaga",
          label: "Siaga Dishub, Satpol PP, Polres",
          pj: "Dishub / Satpol PP / Polres",
        },
        {
          id: "suplai-cadangan",
          label: "Pertamina menyiapkan suplai cadangan",
          pj: "Pertamina Patra Niaga",
        },
      ],
      KRISIS: [
        {
          id: "wfh",
          label: "SE WFH ASN & sekolah daring",
          pj: "Bupati / BKPSDM / Dinas Pendidikan",
        },
        {
          id: "jalur-prioritas",
          label: "Jalur prioritas pekerja esensial",
          pj: "Dishub & Polres",
        },
        {
          id: "jam-layanan",
          label: "Jam layanan antre 05.00–22.00",
          pj: "Dishub / Satpol PP",
        },
        {
          id: "pos-krisis",
          label: "Mode krisis POS: batas volume, blokir jeriken",
          pj: "Pertamina, aktif otomatis",
          auto: true,
        },
        {
          id: "pengalihan-suplai",
          label: "Ajukan pengalihan suplai lintas TBBM",
          pj: "Pemda → Pertamina Patra Niaga",
        },
      ],
    },

    // Kuota per nomor polisi per hari saat mode krisis (wireframe pusat kendali). Niaga: contoh kuota QR.
    quota: { motor: 5, mobil: 20, niaga: 60 },

    // Parameter perilaku. Sumber dicatat di tampilan "Hasil simulasi".
    model: {
      panicIncrease: 0.25, // abstrak: konsumsi harian naik sekitar 25% saat panic buying
      panicTriggerShare: 0.1, // asumsi: panik mulai saat 10% SPBU berstok < 6 jam
      panicRiseHours: 6, // asumsi
      panicFallHours: 24, // asumsi
      hoardShare: 0.08, // asumsi: pembelian spekulan setara 8% konsumsi normal saat panik
      riskCommCut: 0.4, // asumsi: info resmi satu sumber meredam 40% lonjakan panik
      quotaPanicCut: 0.8, // asumsi: kuota per nopol menahan 80% lonjakan panik yang tersisa
      lockEffectiveness: 0.9, // asumsi: 90% pembelian jeriken/tangki modifikasi terblokir
      wfhDemandCut: 0.1, // asumsi: WFH & sekolah daring menurunkan konsumsi 10%
      serviceHeadroom: 2.2, // asumsi: kapasitas layan SPBU = 2,2 x rata-rata penjualan
      serviceMinutes: 4, // asumsi: waktu layan per kendaraan
      queueCapMinutes: 210, // abstrak: antrean sampai 3,5 jam
      avgHoardLiters: 30, // asumsi: volume per percobaan beli jeriken
      speculatorPool: 400, // jumlah nopol spekulan sintetis
    },

    supply: {
      truckKL: 16,
      headroom: 1.15, // asumsi: kapasitas pasok normal 15% di atas konsumsi normal
      leadNormalHours: 3.5, // asumsi: Tanjungwangi → Jember via Gumitir
      leadDisruptedHours: 7.5, // asumsi: lewat jalur alternatif saat Gumitir terganggu
      bucketCapHours: 6, // asumsi: penyangga alokasi terminal setara 6 jam pasokan
      reorderHours: 36,
      catchUpFactor: 1.4, // asumsi: pasokan dinaikkan 40% selama stok wilayah belum pulih
      catchUpBelowShare: 0.9, // batas "belum pulih": stok < 90% stok awal
    },

    scenario: {
      days: 14,
      disruptionStartHour: 30, // hari ke-2 pukul 06.00
      disruptionEndHour: 174, // gangguan 6 hari
      supplyFactorDisrupted: 0.5, // asumsi: pasokan utama ke Jember tinggal 50%
      tankerInflowFactor: 0.6, // asumsi: pasokan kapal ke TBBM Tanjungwangi tinggal 60%
      tankerCatchUpFactor: 1.25, // asumsi: kiriman kapal susulan setelah gangguan selesai
      waspadaDelayHours: 1, // skenario: rekomendasi WASPADA disetujui setelah 1 jam
      policyDelayHours: 3, // skenario: SE krisis terbit 3 jam setelah status KRISIS
      hoaxClarifyHours: 2, // asumsi: klarifikasi resmi terbit 2 jam setelah laporan hoaks masuk (waktu verifikasi)
      dispatchDelayHours: 1, // skenario: Pertamina menyetujui pengalihan 1 jam setelah diminta
      baselinePolicyDelayHours: 120, // abstrak: kebijakan darurat baru terbit setelah 5 hari
    },

    // Ambang ketahanan stok terminal (hari). Asumsi tampilan.
    terminalDays: { crisis: 1.5, low: 2, high: 5 },

    terminals: [
      {
        id: "tanjungwangi",
        name: "TBBM Tanjungwangi",
        lat: -8.126,
        lng: 114.399,
        stockKL: 9000,
        inKLday: 3000,
        outKLday: 3000,
        primary: true,
      },
      {
        id: "malang",
        name: "TBBM Malang",
        lat: -7.93,
        lng: 112.65,
        stockKL: 4100,
        inKLday: 1000,
        outKLday: 1000,
        spareKLday: 180,
        leadHours: 6,
        costPct: 5,
      },
      {
        id: "surabaya",
        name: "TBBM Surabaya Group",
        lat: -7.21,
        lng: 112.73,
        stockKL: 65000,
        inKLday: 10000,
        outKLday: 10000,
        spareKLday: 300,
        leadHours: 9,
        costPct: 8,
      },
    ],

    // Lintasan truk untuk peta (titik perkiraan), berakhir di simpul kota Jember.
    hub: [-8.17, 113.7],
    routes: {
      gumitir: [
        [-8.126, 114.399],
        [-8.219, 114.369],
        [-8.367, 114.15],
        [-8.29, 113.99],
        [-8.27, 113.93],
        [-8.22, 113.87],
        [-8.19, 113.8],
      ],
      alternatif: [
        [-8.126, 114.399],
        [-7.706, 114.009],
        [-7.913, 113.821],
        [-8.11, 113.74],
      ],
      malang: [
        [-7.93, 112.65],
        [-8.133, 113.224],
        [-8.16, 113.45],
      ],
      surabaya: [
        [-7.21, 112.73],
        [-7.645, 112.907],
        [-7.754, 113.215],
        [-8.133, 113.224],
        [-8.16, 113.45],
      ],
    },

    // Profil SPBU sintetis: penjualan harian 16–26 KL (+6 di kota), tangki 2,4 hari penjualan.
    spbuProfile: {
      dailyMinKL: 16,
      dailySpreadKL: 10,
      urbanExtraKL: 6,
      capacityDays: 2.4,
      initialFillMin: 0.55,
      initialFillSpread: 0.3,
      jitterDeg: 0.03,
    },

    userLocation: { name: "Alun-alun Jember", lat: -8.1689, lng: 113.7022 },
    posStation: { spbuName: "Tawang Alun", pump: 3 },

    // Profil konsumsi per jam (00–23), dinormalkan ke rata-rata 1 oleh mesin simulasi.
    diurnal: [
      0.25, 0.2, 0.2, 0.2, 0.3, 0.6, 1.1, 1.5, 1.5, 1.3, 1.1, 1.1, 1.2, 1.1,
      1.0, 1.1, 1.4, 1.6, 1.5, 1.3, 1.1, 0.9, 0.6, 0.4,
    ],

    // Sebaran SPBU ilustratif: titik tengah kecamatan (perkiraan) dan jumlah SPBU.
    // Total 58 mengikuti contoh pada wireframe; ganti dengan data resmi bila tersedia.
    kecamatan: [
      {
        name: "Kaliwates",
        lat: -8.1845,
        lng: 113.668,
        count: 5,
        urban: true,
        names: ["Kaliwates", "Mangli"],
      },
      { name: "Sumbersari", lat: -8.17, lng: 113.723, count: 5, urban: true },
      { name: "Patrang", lat: -8.145, lng: 113.705, count: 4, urban: true },
      {
        name: "Rambipuji",
        lat: -8.205,
        lng: 113.612,
        count: 3,
        names: ["Tawang Alun"],
      },
      { name: "Ajung", lat: -8.245, lng: 113.653, count: 2, names: ["Ajung"] },
      { name: "Jenggawah", lat: -8.27, lng: 113.65, count: 2 },
      { name: "Ambulu", lat: -8.345, lng: 113.605, count: 3 },
      { name: "Wuluhan", lat: -8.33, lng: 113.53, count: 2 },
      { name: "Balung", lat: -8.26, lng: 113.54, count: 2 },
      { name: "Puger", lat: -8.37, lng: 113.47, count: 2 },
      { name: "Kencong", lat: -8.28, lng: 113.37, count: 2 },
      { name: "Gumukmas", lat: -8.32, lng: 113.42, count: 1 },
      { name: "Umbulsari", lat: -8.26, lng: 113.45, count: 1 },
      { name: "Semboro", lat: -8.2, lng: 113.44, count: 1 },
      { name: "Tanggul", lat: -8.16, lng: 113.45, count: 3 },
      { name: "Bangsalsari", lat: -8.2, lng: 113.53, count: 2 },
      { name: "Sumberbaru", lat: -8.12, lng: 113.39, count: 1 },
      { name: "Jombang", lat: -8.25, lng: 113.34, count: 1 },
      { name: "Sukorambi", lat: -8.15, lng: 113.64, count: 1 },
      { name: "Panti", lat: -8.17, lng: 113.62, count: 1 },
      { name: "Arjasa", lat: -8.11, lng: 113.74, count: 2 },
      { name: "Pakusari", lat: -8.16, lng: 113.76, count: 1 },
      { name: "Kalisat", lat: -8.13, lng: 113.81, count: 2 },
      { name: "Sukowono", lat: -8.06, lng: 113.83, count: 1 },
      { name: "Ledokombo", lat: -8.15, lng: 113.89, count: 1 },
      { name: "Mayang", lat: -8.19, lng: 113.8, count: 1 },
      { name: "Silo", lat: -8.22, lng: 113.87, count: 2 },
      { name: "Mumbulsari", lat: -8.25, lng: 113.74, count: 1 },
      { name: "Tempurejo", lat: -8.29, lng: 113.7, count: 1 },
      { name: "Jelbuk", lat: -8.08, lng: 113.76, count: 1 },
      { name: "Sumberjambe", lat: -8.07, lng: 113.9, count: 1 },
    ],
  };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
