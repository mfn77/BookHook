# 📚 BookHook

**BookHook**, bir WhatsApp kitap kulübü için geliştirilmiş; günlük okuma takibi, ceza kurası, hediye kitap sistemi ve mini bir sosyal ağı bir araya getiren, Firebase tabanlı bir PWA (Progressive Web App).

Canlı: `https://<kullanıcı-adın>.github.io/<repo-adın>/`

---

## ✨ Özellikler

### Günlük Okuma Takibi
- Her gün "Okudum ✓ / Okumadım ✕" işaretlemesi (gün değişimi TR saatiyle 06:00'da).
- Yönetici için tüm üyeleri tek ekrandan işaretleme, geçmiş günleri düzenleme.
- Haftalık "karne" tablosu — kim hangi gün okumuş, cezalı/pas/kusursuz durumu.
- Aktif okuma serisi, rozet sistemi (3/5/7/14/21/30 gün aralıksız), rozet geçmişi tablosu.

### Kura & Hediye Kitap
- Cezalı olanlar (haftada 2+ gün okumayan) ile kusursuz/pas geçenler arasında otomatik, adil (round-robin, öncelik sıralı) kura.
- Hediye alacak kişi, istediği kitabı arayarak seçer (kapak görseli otomatik gelir), adres/telefon bilgisi profilden otomatik doldurulur.
- "Gönderdim" / "Aldım" onay akışı, geçmiş hediyeler.

### Sosyal (Akış & Keşfet)
- **Akış**: kulübün ortak zaman tüneli — okuma işaretlemeleri, rozet kazanma/kaybetme, hediye kazanma/teslim alma, yeni üye katılımı ve kitap puanlamaları otomatik gönderi olarak düşer. Elle metin/görselli gönderi de paylaşılabilir.
- Gönderilere ve yorumlara emoji tepkisi (özel emoji girişi dahil), yorum yapma.
- **Keşfet**: türe göre (Open Library üzerinden) popüler kitaplar, grup içi 1-10 puanlama ve yorumlar, "Tavsiye Kitaplar" (yönetici onaylı) özel listesi.

### Diğer
- Kişisel kitaplık (okunan kitapların listesi), profil kartından başkalarınınkini görüntüleme.
- Kitap kapaklarına/adlarına dokunarak yazar, yayınevi, tür, puan gibi bilgileri gösterme (Open Library + Google Books yedekli).
- Şahsi/gruba kitap önerileri, yorum ve tepki.
- Gerçek zamanlı push bildirimleri (Firebase Cloud Messaging) + her gün 14:00 ve 22:00'de, o gün henüz işaretleme yapmayanlara otomatik hatırlatma.
- PWA: telefona/bilgisayara "uygulama" gibi kurulabilir, çevrimdışı önbellekleme.

---

## 🛠️ Teknoloji

- **Frontend**: Tek dosyalık vanilla HTML/CSS/JavaScript (`index.html`), harici çerçeve yok.
- **Backend**: [Firebase](https://firebase.google.com/) — Authentication, Firestore (veritabanı), Cloud Functions (2. nesil, push bildirimleri ve zamanlanmış hatırlatmalar için).
- **Barındırma**: GitHub Pages (statik dosyalar) — `sw.js` service worker ile önbellekleme ve arka plan push desteği.
- **Dış veri**: [Open Library API](https://openlibrary.org/developers/api) (kitap arama/bilgi, birincil), [Google Books API](https://developers.google.com/books) (yedek).

---

## 📁 Dosya Yapısı

```
.
├── index.html              # Tüm uygulama (HTML+CSS+JS, tek dosya)
├── sw.js                    # Service worker: önbellekleme + arka plan push bildirimleri
├── manifest.json            # PWA manifesti (isim, ikonlar, tema rengi)
├── icon-512.png             # Uygulama ikonu (ana ekran / favicon)
├── icon-192.png
├── apple-touch-icon.png
├── favicon.png
├── logo-mark.png            # Uygulama içindeki (giriş ekranı + sol üst) logo, şeffaf zeminli
├── firestore.rules          # Firestore güvenlik kuralları
└── cloud-function-debug/
    └── index.js             # Cloud Functions kaynağı (push bildirimleri + zamanlanmış hatırlatmalar)
```

---

## 🔒 Güvenlik

- Firebase istemci yapılandırması (`apiKey` vb.) ve FCM VAPID anahtarı, Google'ın tasarımı gereği herkese açıktır — güvenlik bunlarla değil, `firestore.rules` ile sağlanır.
- Kayıt olan hiçbir hesap kendini yönetici olarak işaretleyemez; kurallar bunu sunucu tarafında zorunlu olarak engeller (bkz. yukarıdaki "İlk Yönetici Hesabı").
- Google Books API anahtarını kullanıyorsan, Google Cloud Console'da anahtara **HTTP referrer kısıtlaması** ekleyip sadece kendi alan adından çalışmasını sağlaman önerilir.

---

## 🚀 Kurulum

### 1. Firebase Projesi
1. [Firebase Console](https://console.firebase.google.com/)'da yeni bir proje oluştur.
2. **Authentication** → Email/Şifre girişini etkinleştir.
3. **Firestore Database** → veritabanını oluştur, `firestore.rules` içeriğini Rules sekmesine yapıştır ve yayınla.
4. **Cloud Messaging** → bir Web Push sertifikası (VAPID key) oluştur.
5. `index.html` içindeki Firebase yapılandırma bilgilerini (`apiKey`, `authDomain`, `projectId` vb.) ve VAPID anahtarını kendi projenle değiştir.

### 2. Cloud Functions (push bildirimleri + hatırlatmalar)
`cloud-function-debug/index.js` içeriğini Firebase projendeki Functions kaynağına koyup deploy et:
```bash
firebase deploy --only functions
```
Bu, üç fonksiyon oluşturur:
- `sendPushOnNotification` — uygulama içi bir bildirim oluşturulduğunda gerçek push gönderir.
- `readingReminderNoon` / `readingReminderNight` — her gün TR saatiyle 14:00 ve 22:00'de, henüz işaretleme yapmamış üyelere hatırlatma gönderir (Cloud Scheduler gerektirir, Blaze planı şart).

### 3. Google Books API Anahtarı (opsiyonel)
Open Library birincil kaynak olduğu için zorunlu değil; sadece Google Books'u yedek olarak daha güvenilir kullanmak istersen `index.html` içindeki `GOOGLE_BOOKS_API_KEY` alanına kendi anahtarını ekleyebilirsin.

### 4. Yayınlama
Tüm dosyaları GitHub reponun `main` dalına yükle, **Settings → Pages** kısmından `main` dalını kaynak olarak seç. Site `https://<kullanıcı-adın>.github.io/<repo-adın>/` adresinde yayınlanır.

### 5. İlk Yönetici Hesabı
Güvenlik açısından, **kimse kayıt olurken kendini yönetici yapamaz** — Firestore kuralları her yeni hesabı zorunlu olarak `member` (üye) rolüyle oluşturur. Bu yüzden ilk yönetici hesabı elle atanmalı:

1. Kendi hesabınla normal şekilde üye ol (e-posta/şifre veya Google ile).
2. Firebase Console → **Firestore Database** → `users` koleksiyonuna gir, kendi belgeni bul.
3. İçindeki `role` alanını `"member"`den `"admin"` olarak değiştir, kaydet.
4. Artık uygulama içinde yönetici olarak görünürsün.

**Sonraki yöneticiler için elle bir şey yapmana gerek yok** — yönetici olarak ☰ menü → **Üyeler** ekranına girip, yönetici yapmak istediğin kişinin yanındaki **"Yönetici Yap"** tuşuna basman yeterli.

---

## 📱 Kullanım

Uygulamayı telefonda "gerçek bir uygulama" gibi kullanmak için tarayıcının "Ana Ekrana Ekle" özelliğini kullanabilirsin (Android: Chrome ⋮ menü, iOS: Safari Paylaş → Ana Ekrana Ekle — **push bildirimleri iOS'ta yalnızca bu şekilde eklendiğinde çalışır**). Uygulama içindeki ☰ menüden "Kullanım Rehberi"ne bakarak tüm özellikleri adım adım öğrenebilirsin.

---

## 📝 Lisans

Bu proje kişisel/kulüp içi kullanım için geliştirilmiştir.
