/* Feed posts, polls, votes, comments, and reactions. Also handles automatic posts and the post editor. */
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, runTransaction,
  startAfter, updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderReactionBar, setPendingReactionRefresh, showReactorsModal, toggleReactionDrawer } from "./reactions.js";
import { notifyUser } from "./notifications.js";
import { canMentionAll, extractMentions, highlightMentions } from "./mentions.js";
import { dailyQuestionsPostBodyHtml, fillDailyQuestionStats, renderDailyQuestionsCard } from "./daily-questions.js";
/*
 * This module and app.js import each other. Shared values are only read inside functions after startup,
 * not while the modules are loading.
 */
import {
  BADGE_DEFS, activeTab, closeModal, currentUid, db, escapeHtml, hideAnchoredPopover,
  keepOrLoading, markLoaded, materialBookCover, myProfile, pad, profilePhotoHtml,
  showAnchoredPopover, showSimpleInfoModal, showToast, turkishAccusativeName, turkishDativeName,
  userChipHtml, usersCache
} from "./app.js";

const READ_MESSAGES_BY_HOUR = {
  0: ['Yeni günün ilk dakikaları, raflarda sessizce bekleyen bir hikâyeye "merhaba" demek için güzel bir bahaneydi.', 'Külkedisi balodan ayrılmış olabilir; ama en güzel masallar bazen tam gece yarısında başlar.', 'Şehrin gürültüsü sustuğunda kelimelerin sesi daha belirgin duyulur.', 'Takvim yeni bir güne geçti; o ise çoktan başka bir evrenin sınırlarını aşmıştı.', 'Gece yarısı, kitapların en cömert olduğu vakittir; okura hiç ummadığı dünyalar sunarlar.', 'Bazı kapılar anahtarla açılır, bazılarıysa gece yarısı çevrilen ilk sayfayla.', 'Uykunun daveti nazikti; merakın daveti ise karşı konulamayacak kadar güçlüydü.', 'Bir kütüphanenin rafları, tam bu saatte fısıldaşmaya başlıyor olmalı.', 'Saat sıfırı gösterirken gerçek dünya kısa bir mola verdi; hayal gücü nöbeti devraldı.', 'Yeni günün ilk izi, çevrilen bir sayfanın çıkardığı o tanıdık ses oldu.'],
  1: ['Sherlock Holmes bile böylesine sessiz bir gecede satırların arasındaki ipuçlarını takdir ederdi.', 'Gece ilerledikçe odadaki tek hareket, usulca çevrilen sayfalardı.', 'Merakın saate ihtiyacı yoktur; yalnızca anlatılmayı bekleyen iyi bir hikâyeye ihtiyacı vardır.', 'Bazı yolculuklar tren garından değil, ilk paragraftan başlar.', 'Ay gökyüzünü aydınlatırken kitap da düşünceleri aydınlatıyordu.', 'Bu saatte kelimeler, gündüz olduğundan biraz daha derin görünür.', 'Sessizlik, iyi yazılmış bir romanın en sadık okuma arkadaşıdır.', 'Gecenin en güzel yanı, kimsenin hayal kurmaya acele ettirmemesidir.', 'Saat ilerledikçe zaman değil, yalnızca okunacak sayfa sayısı önemini korudu.', 'Dışarıda gece vardı; içeride ise bambaşka bir mevsim yaşanıyordu.'],
  2: ['Morpheus sabırla bekledi; çünkü hikâye henüz son sözünü söylememişti.', 'Gecenin bu saatinde açılan kitaplar, okuruyla sessiz bir anlaşma yapar.', 'Uzak diyarlara gitmek bazen yalnızca bir sayfa çevirmek kadar kolaydır.', 'Ay ışığı pencereye vururken satırlar zihinde yeni yollar açıyordu.', 'Bazı cümleler, gündüzün telaşında değil gecenin dinginliğinde gerçek anlamını bulur.', 'Dünya yavaşlamıştı; ama hikâye tam aksine hız kazanıyordu.', 'En güzel keşiflerin bir pusulaya değil, iyi yazılmış bir romana ihtiyacı vardır.', 'Saat iki olduğunda kahramanlar çoktan hafızanın bir köşesine yerleşmişti.', 'Gözler yorulabilir; ama iyi bir hikâyeye duyulan merak kolay kolay yorulmaz.', 'Gece, satırların arasındaki boşlukları bile anlamla doldurur.'],
  3: ['Victor Frankenstein\'ın laboratuvarı kadar sessiz bir gecede, yeni fikirler sayfaların arasından doğuyordu.', 'Bu saat, yalnızca uykusuzların değil, hayal kurmaktan vazgeçmeyen okurların da zamanıdır.', 'Gecenin en derin sessizliği, en güçlü anlatıcılardan biridir.', 'Raflarda yıllarca bekleyen bir kitap, sonunda hak ettiği okurla buluştu.', 'Bazı hikâyeler güneş ışığını değil, yıldızların tanıklığını sever.', 'Saat üçte zaman ağır akar; ama iyi yazılmış bir roman bunu unutturur.', 'Her çevrilen sayfa, bilinmeyene doğru atılmış küçük bir adımdır.', 'Dışarıda herkes dinlenirken zihin yeni karakterlerle tanışıyordu.', 'En uzun geceler bile iyi bir kitabın içinde kısa gelir.', 'Sessizlik bazen en etkileyici ön sözdür.'],
  4: ['Şafak henüz görünmemişti; ama satırlar çoktan ufuk çizgisini aşmıştı.', 'Odysseus eve dönmek için denizleri aştı; o ise birkaç bölümle sayısız dünyayı dolaştı.', 'Gün doğmadan önce okunan sayfaların kendine özgü bir huzuru vardır.', 'Gökyüzü yavaş yavaş renk değiştirirken hikâye de yeni bir yöne evriliyordu.', 'Uyanan ilk şey bazen güneş değil, meraktır.', 'Sabahın serinliğiyle birlikte kelimeler de tazelenmiş gibiydi.', 'Günün ilk ışıkları yaklaşırken kitabın atmosferi odanın havasını değiştirmişti.', 'Şafaktan önce kazanılan sessizlik, okumanın en değerli armağanlarından biridir.', 'Her yeni gün, okunmayı bekleyen yeni bir hikâye demektir.', 'Gecenin son perdesi kapanırken kitabın sahnesi hâlâ açıktı.'],
  5: ['İlk kuş sesleri duyulurken roman son hız yoluna devam ediyordu.', 'Don Kişot değirmenlere doğru yola çıkmıştı; o ise yeni bir bölümün peşine.', 'Sabahın ilk ışıklarıyla birlikte zihinde onlarca yeni düşünce filizlenmişti.', 'Güne başlamak için bazılarının alarma, bazılarının ise yalnızca iyi bir kitaba ihtiyacı vardır.', 'Şafak, sayfalar arasında geçirilen saatleri usulca selamladı.', 'Gün doğarken raflardaki yüzlerce hikâyeden biri artık tanıdık bir dosta dönüşmüştü.', 'Erken saatlerin en güzel ayrıcalığı, dünyanın henüz sessiz olmasıdır.', 'Yeni gün, yeni hedefler getirdi; ama ilk durak yine kitap oldu.', 'Sabahın serin havası, hikâyenin bıraktığı sıcak duyguyla dengeleniyordu.', 'Güneş ufukta görünürken bir kitap daha unutulmaz anılar arasındaki yerini aldı.'],
  6: ['Güneş doğdu; ama bugünün ilk keşfi gökyüzünde değil, satırların arasındaydı.', 'Her sabah yeni bir başlangıçtır; en güzellerinden bazıları kitap kapağı açılarak yapılır.', 'Sabahın ilk ışıkları, okunan her cümlenin üzerine ayrı bir umut bırakır.', 'Gün henüz telaşa kapılmamışken birkaç sayfa okumak, zamana verilmiş küçük bir meydan okumadır.', 'Kuşlar şarkılarını söylerken kelimeler de kendi melodisini kuruyordu.', 'Yeni bir günün en güzel kahvaltısı bazen birkaç iyi paragraftır.', 'Sabahın sessizliği, yazarların en görünmez ortağıdır.', 'Güne erkenden başlayanların bildiği bir sır vardır: Hikâyeler de sabahları daha canlıdır.', 'Güneş pencereyi aydınlattı; kitap ise zihni.', 'İlk ışıklarla birlikte yeni bir dünyanın kapısı aralandı.'],
  7: ['Alice tavşanı izledi; o ise merakını.', 'Çayın buharı yükselirken hikâye de yavaş yavaş şekilleniyordu.', 'Gün planları bekleyebilir; iyi yazılmış bir bölüm her zaman önceliklidir.', 'Sabah telaşı başlamadan önce birkaç sayfa okumak, güne yapılan sessiz bir yatırımdır.', 'Raflardan seçilen o kitap, bugünün en doğru kararı oldu.', 'Bazı sabahlar haberlerle başlar; bazıları ise romanlarla güzelleşir.', 'Sabah güneşi perdeyi açtı, kitap ise hayal gücünü.', 'Yeni gün, yeni karakterlerle tanışmak için güzel bir fırsattı.', 'En sakin sabahlar, en unutulmaz hikâyeleri ağırlayabilir.', 'Takvim bugünü gösteriyordu; kitap ise bambaşka zamanları.'],
  8: ['Bilbo Baggins\'in kapısını bir büyücü çalmıştı; bugün ise macera kitabın ilk sayfasından geldi.', 'Günün koşuşturması başlamadan önce yapılan en değerli yolculuk, satırlar arasındaki yolculuktur.', 'Masadaki fincan boşalabilir; ama iyi bir hikâye kolay kolay tükenmez.', 'Her çevrilen sayfa güne yeni bir renk kattı.', 'Dünyanın en sessiz sohbetlerinden biri, okur ile kitap arasında gerçekleşir.', 'Bazı sabahlar yalnızca okunarak güzelleşir.', 'Güne umutla başlamanın pek çok yolu vardır; bunlardan biri de kitap açmaktır.', 'Kelimeler bazen kahveden daha güçlü uyandırır.', 'Yeni bir bölüm, yeni bir bakış açısı getirdi.', 'Gün başlamış olabilir; ama hayal gücü çok daha erken uyanmıştı.'],
  9: ['Jean Valjean\'ın ikinci bir şans bulduğu gibi, her kitap da okuruna yeni bir başlangıç sunar.', 'Üretken bir günün en sağlam temeli bazen tek bir sayfadır.', 'Okunan her bölüm, düşüncelere yeni bir pencere açtı.', 'Bilginin en sessiz öğretmeni çoğu zaman kitaplardır.', 'Sabahın enerjisiyle birleşen iyi bir hikâye uzun süre akılda kalır.', 'Zaman ilerledi; merak yerinde durmadı.', 'Kitaplar acele etmez; ama okuru mutlaka bir yere ulaştırır.', 'En güzel keşiflerden bazıları haritalarda bulunmaz.', 'Satırların arasında kaybolmak bazen kendini bulmanın başka bir yoludur.', 'Bugün öğrenilecek ilk şey, kitabın anlattıkları oldu.'],
  10: ['Hercule Poirot ayrıntıları incelerdi; iyi bir okur da satır aralarını.', 'Güneş yükseldikçe hikâye de derinleşmeye başladı.', 'Kitaplar konuşmaz; ama anlatacakları hiç bitmez.', 'Her bölüm yeni bir soru, her sayfa yeni bir cevap olabilir.', 'Okuma, zamana karşı değil, unutmaya karşı kazanılan bir mücadeledir.', 'Bazen en büyük keşif, yeni bir düşünceyle karşılaşmaktır.', 'Bugün de birkaç sayfa, yüzlerce düşünce doğurdu.', 'İyi yazılmış cümleler yıllar geçse de ilk günkü etkisini korur.', 'Hayal gücü için en verimli toprak, iyi kitapların sayfalarıdır.', 'Öğlene yaklaşırken hikâye tam anlamıyla hayat buldu.'],
  11: ['Edmond Dantès sabrı öğrendi; kitaplar da okura aynı erdemi fısıldar.', 'Gün yükseldikçe hikâye de kendi doruğunu arıyordu.', 'Öğleye yaklaşırken sayfalar zamanın nasıl geçtiğini unutturdu.', 'İyi bir kitap, saate bakmayı gereksiz kılar.', 'Bazı cümleler yalnızca okunmaz; uzun süre zihinde yaşamaya devam eder.', 'Her bölüm tamamlandığında yeni bir merak doğar.', 'Hikâyeler yalnızca anlatılmaz; yaşanır da.', 'Kitaplar raflarda bekler; doğru zamanı geldiğinde okurunu bulur.', 'Günün en güzel molası, birkaç satırlık bir yolculuktu.', 'Öğle güneşi yaklaşırken hikâye hâlâ bütün canlılığıyla devam ediyordu.'],
  12: ['Öğle güneşi yükselirken hikâye de tam anlamıyla ritmini buldu.', 'Günün ortasında yapılan kısa bir okuma, zihne uzun bir mola armağan eder.', 'Öğle saatleri bazen bir kitabın en güzel bölümüne denk gelir.', 'Masadaki tabak boşalabilir; ama merak kolay kolay doymaz.', 'Her çevrilen sayfa, günün telaşını biraz daha geride bıraktı.', 'Kütüphaneler sessizdir; ama içlerinde sayısız hayat aynı anda yaşar.', 'Güne kısa bir ara vermenin en güzel yollarından biri, iyi bir kitaptır.', 'Satırlar arasında geçirilen dakikalar, saatin gösterdiğinden daha değerlidir.', 'Bugünün en güzel sohbeti, yazar ile okur arasında gerçekleşti.', 'Öğle vakti, yeni düşüncelerin filizlenmesi için en verimli saatlerden biridir.'],
  13: ['Atticus Finch\'in öğrettiği gibi, anlamak bazen yalnızca dikkatle dinlemekle başlar; kitaplar da bunu sabırla öğretir.', 'Gün ilerledikçe karakterler de daha tanıdık gelmeye başladı.', 'Bazı yolculuklar bavul istemez; yalnızca açık bir kitap yeterlidir.', 'Her bölüm, zihne yeni bir pencere açtı.', 'Satırlar arasında dolaşırken zaman usulca akıp gitti.', 'Hikâyeler, onları paylaşan okurlarla yaşamaya devam eder.', 'Bir kitabın en güzel yanı, her okurun onu farklı okumasıdır.', 'Sessizce çevrilen sayfalar bile bazen uzun konuşmalardan daha çok şey anlatır.', 'Öğleden sonra yaklaşırken merak hâlâ ilk sayfadaki kadar canlıydı.', 'İyi yazılmış bir paragraf, günün bütün temposunu değiştirebilir.'],
  14: ['Kaptan Nemo okyanusun derinliklerini keşfetti; bugün ise keşfedilen yer, satırların derinliğiydi.', 'Günün en parlak ışığında bile kitaplar kendi gölgelerini oluşturur.', 'Her yeni bölüm, daha önce hiç gidilmemiş bir sokağa benzer.', 'Okunan her cümle, düşüncelere sessizce yerleşti.', 'En büyük keşiflerden bazıları masadan kalkmadan yapılır.', 'Gün ortasında birkaç sayfa okumak, zamana verilmiş küçük bir hediyedir.', 'Hayal gücü güneş saatine göre çalışmaz.', 'Her kitap, okurunun zihninde ikinci kez yazılır.', 'Bugün de yeni bir hikâye hafızada yerini aldı.', 'Bazen tek bir cümle, uzun bir yolculuğun başlangıcı olabilir.'],
  15: ['Raskolnikov\'un sorguladığı vicdan gibi, bazı kitaplar da okuru kendisiyle konuşmaya davet eder.', 'Gün yavaş yavaş akşama yaklaşırken hikâye hız kesmedi.', 'Her karakter, başka bir insanı anlamanın yeni bir yoludur.', 'Sayfalar arasında dolaşırken dışarıdaki zaman önemini yitirdi.', 'İyi kitaplar yalnızca okunmaz; uzun süre düşünülür.', 'Okuma, zihnin yaptığı en sessiz keşif yolculuğudur.', 'Her bölüm bittiğinde, geriye yeni sorular kaldı.', 'Bugünün en uzun yolculuğu birkaç santimetrelik sayfaların içinde gerçekleşti.', 'Bazı cümleler, ilk okunduğu andan itibaren unutulmayı reddeder.', 'Güneş batıya yönelirken hikâye de en güçlü anlarına ulaşıyordu.'],
  16: ['Dorian Gray zamana meydan okumaya çalıştı; kitaplar ise bunu her nesilde yeniden başarır.', 'Akşam yaklaşırken satırlar daha da derinleşti.', 'Her kitabın kendi mevsimi vardır; bazıları dört mevsimi aynı anda yaşatır.', 'Günün yorgunluğu, iyi yazılmış birkaç paragrafla hafifledi.', 'Sayfalar çevrildikçe düşünceler de yön değiştirdi.', 'Kitapların en güzel yanı, her dönüşte yeni bir ayrıntı göstermeleridir.', 'Bazen en sessiz anlar, en büyük farkındalıkları getirir.', 'İyi bir hikâye, günü bölmez; güzelleştirir.', 'Gözler satırları takip ederken zihin çoktan başka diyarlara ulaşmıştı.', 'Gün batımına doğru ilerlerken kitap hâlâ yeni sürprizler sunuyordu.'],
  17: ['Küçük Prens\'in tilkisi gibi, bazı kitaplarla da zaman geçirdikçe aranda görünmez bağlar oluşur.', 'Günün son mesaisi, hayal gücüne devredildi.', 'Gün boyunca biriken düşünceler, satırlar arasında yerini buldu.', 'Hikâyeler bazen yorgunluğu değil, yalnızca sessizliği ister.', 'Her kitap, okuruna küçük de olsa bir iz bırakır.', 'Akşam yaklaşırken merak hâlâ ilk bölümdeki kadar güçlüydü.', 'Okumak, günü daha uzun yaşamanın en güzel yollarından biridir.', 'Gün biterken hafızaya yeni isimler, yeni yerler ve yeni duygular eklendi.', 'Bazı karakterler kitabın içinde kalmaz; okurun zihnine taşınır.', 'Günün son ışıklarıyla birlikte hikâye de okurunun bir parçası hâline geldi.'],
  18: ['Gandalf\'ın dediği gibi, bize verilen zamanı nasıl değerlendireceğimiz önemlidir; bugün bunun cevabı birkaç güzel sayfada saklıydı.', 'Gün batımı gökyüzünü boyarken satırlar da hayal gücünü renklendiriyordu.', 'Günün yorgunluğu, iyi yazılmış bir hikâyenin omzuna bırakıldı.', 'Bazı akşamlar uzun sohbet ister, bazılarıysa yalnızca iyi bir kitap.', 'Güneş ufka çekilirken karakterler daha da canlı görünmeye başladı.', 'Akşamın serinliği, sayfalardaki sıcak hikâyelerle dengelendi.', 'Her günün sonunda anlatılacak yeni bir hikâye bulunabilir.', 'Gün kapanırken kitap yeni kapılar açmaya devam etti.', 'Günlük telaş yerini satırların dinginliğine bıraktı.', 'Akşamın ilk dakikaları, hayal gücü için en güzel davetiyelerden biridir.'],
  19: ['Harry Potter\'ın peron dokuz üç çeyreği vardı; bugün ise yolculuk yalnızca açılan bir kitapla başladı.', 'Çayın buharı yükselirken hikâye de usulca derinleşti.', 'Akşam, kitap raflarının en çok sevdiği misafirdir.', 'Günün en güzel kaçamağı bazen yalnızca birkaç bölüm sürer.', 'Dışarıda lambalar yanarken satırlar da zihinde ışık yakıyordu.', 'Her akşam yeni bir dünyanın kapısını çalmak mümkündür.', 'Koltuğa yerleşmek bazen uzun bir yolculuğun ilk adımıdır.', 'Günün temposu geride kaldı; sıra meraka geldi.', 'Akşam saatleri, kitapların sesi biraz daha güçlü çıkar.', 'Hikâyeler, gün batımını beklemeyi iyi bilir.'],
  20: ['Aslan\'ın cesareti gibi bazı hikâyeler de okurun içinde uzun süre yaşamaya devam eder.', 'Gecenin ilk perdesi açılırken roman da en etkileyici sahnelerini göstermeye başladı.', 'Düşünceler yavaşladı; merak hızlandı.', 'Her çevrilen sayfa günü biraz daha güzelleştirdi.', 'En iyi yol arkadaşlarından biri, kapağı açılmış bir kitaptır.', 'Zaman ilerledi; hikâye geride kalmayı reddetti.', 'Kitaplar, akşamın en sessiz misafiridir.', 'Günün son saatleri, yeni fikirler için her zaman bereketlidir.', 'Bazı karakterlerle vedalaşmak kolay değildir.', 'İyi bir roman, akşamı olduğundan daha kısa hissettirir.'],
  21: ['Arsène Lupin\'in çaldığı şey mücevherlerdi; iyi kitaplar ise fark ettirmeden kalpleri çalar.', 'Gün geride kaldı; anlatılacak hikâyeler ise hâlâ masadaydı.', 'Her bölüm, günü biraz daha unutulmaz kıldı.', 'Gecenin başlamasıyla birlikte hayal gücü de mesaisine başladı.', 'Kitaplar bazen en iyi dostluğu tek kelime etmeden kurar.', 'Sayfalar ilerledikçe düşünceler de derinleşti.', 'Hikâyeler, okurun zihninde ikinci bir ömür yaşar.', 'Bazı akşamlar yalnızca okumak yeterlidir.', 'Günün bütün gürültüsü dışarıda kaldı.', 'Kelimeler, geceyi usulca doldurmaya devam etti.'],
  22: ['Winston Smith gerçeği arıyordu; bugün ise cevaplar satırların arasında saklıydı.', 'Gecenin ilerleyen saatleri, düşüncelerin en berrak olduğu anlardır.', 'Kitabın sonlarına yaklaşmak bazen sevilen bir şehirden ayrılmak gibidir.', 'Her sayfa, zihinde yeni bir iz bıraktı.', 'Hikâyenin ritmi gecenin ritmiyle uyum içindeydi.', 'Gün biterken öğrenilecek yeni şeyler hâlâ vardı.', 'İyi kitaplar, kapakları kapandıktan sonra da konuşmaya devam eder.', 'Gece büyüdükçe hayal gücü de sınırlarını genişletti.', 'Bazı cümleler yalnızca okunmaz; insanın içinde yankılanır.', 'Saat ilerledi, ama hikâye acele etmiyordu.'],
  23: ['Gregor Samsa\'nın sabahı sıra dışı başlamıştı; bu gün ise sıra dışı bir hikâyeyle sona erdi.', 'Günün son saatleri, en güzel vedaların yaşandığı sayfalara ayrıldı.', 'Kapanan yalnızca gün oldu; hikâye zihinde yaşamaya devam etti.', 'Kitabın kapağı kapandı, ama bıraktığı iz kapanmadı.', 'Günün sonunda kazanılan en değerli şey, yeni bir bakış açısıydı.', 'Her hikâye biter; iyi olanlar ise okurun içinde yaşamayı sürdürür.', 'Yıldızlar gökyüzünü süslerken satırlar hafızayı süslüyordu.', 'Bugün okunan sayfalar, yarının düşüncelerine sessizce karışacak.', 'Gün sona erdi; ama keşfedilecek dünyaların sayısı hiç azalmadı.', 'Yarın yeni bir gün, rafta ise yeni bir macera bekliyor.'],
};
const SKIP_MESSAGES = {
  midnight: ["🌙 Gece yarısı oldu, kitap hâlâ kapalı.", "😴 Gün kitapsız bitmek üzere."],
  deepNight: ["🌌 Gece de kitapsız geçiyor.", "💤 Bugünlük pas geçti."],
  preDawn: ["😅 Sabaha karşı olmuş ama kitap açılmamış.", "🥱 Gün bitmeden bir şans daha var."],
  dawn: ["😅 Sabah olmuş ama kitap henüz açılmamış.", "🥱 Sabah biraz mola verdi."],
  morning: ["☁️ Bugünkü sayfalar bekliyor.", "🙈 Sabah kitaba vakit bulamadı."],
  lateMorning: ["🙈 Öğleye yaklaşıldı, kitap hâlâ kapalı.", "⏳ Sabah kitaba vakit ayıramadı."],
  midday: ["🙈 Öğlen oldu, kitap hâlâ kapalı.", "⏳ Vakit bulamadı bugün."],
  afternoon: ["📵 Bugün araya bir şey girdi.", "😬 Öğleden sonra da olmadı."],
  lateAfternoon: ["📚 Kitap masada bekliyor.", "😬 İkindi de geçti, okuyamadı."],
  evening: ["😬 Akşam oldu, henüz okumadı.", "🌆 Gün bitmeden bir fırsat kalsın."],
  dusk: ["📚 Kitap masada bekliyor.", "😴 Akşam da geçti, okuyamadı."],
  night: ["😴 Bugün kitapsız geçti.", "🌙 Yarın telafi vakti."]
};
function timeBucket(hour){
  if(hour>=0 && hour<2) return 'midnight';
  if(hour>=2 && hour<4) return 'deepNight';
  if(hour>=4 && hour<6) return 'preDawn';
  if(hour>=6 && hour<8) return 'dawn';
  if(hour>=8 && hour<10) return 'morning';
  if(hour>=10 && hour<12) return 'lateMorning';
  if(hour>=12 && hour<14) return 'midday';
  if(hour>=14 && hour<16) return 'afternoon';
  if(hour>=16 && hour<18) return 'lateAfternoon';
  if(hour>=18 && hour<20) return 'evening';
  if(hour>=20 && hour<22) return 'dusk';
  return 'night';
}
async function getLastPostMessageOfType(type){
  try{
    const snap = await getDocs(query(collection(db,'posts'), orderBy('createdAt','desc'), limit(15)));
    let found = null;
    snap.forEach(d=>{ if(!found && d.data().type===type) found = d.data().variantText; });
    return found;
  }catch(e){ return null; }
}
export async function pickVariantMessage(type){
  const hour = new Date().getHours();
  const pool = type==='read' ? READ_MESSAGES_BY_HOUR[hour] : SKIP_MESSAGES[timeBucket(hour)];
  const lastText = await getLastPostMessageOfType(type);
  const candidates = lastText ? pool.filter(m=>m!==lastText) : pool;
  const finalPool = candidates.length ? candidates : pool;
  return finalPool[Math.floor(Math.random()*finalPool.length)];
}
/*
 * Feed notifications. Every member gets exactly one notification per event, picked in this order:
 * 1. members mentioned with @ (and everyone, when an admin writes @herkes),
 * 2. the author of the post or comment that received the comment, reaction or like,
 * 3. members who have commented on, reacted to or liked the post,
 * 4. everyone else, but only until FEED_BOOST_UNTIL: a launch period meant to get the feed going.
 *    New posts reach their phones too; comments, reactions and likes only appear in the app's
 *    notification list, so the launch period doesn't turn into a stream of phone notifications.
 * Members who turned off feed notifications in their settings get none (see notifyUser).
 */
export const FEED_BOOST_UNTIL = Date.parse('2026-10-29T06:00:00+03:00');
export function feedBoostActive(){ return Date.now() < FEED_BOOST_UNTIL; }

const snippet = (t)=>{ const s = String(t||'').replace(/\s+/g,' ').trim(); return s.length>70 ? s.slice(0,70)+'...' : s; };

// Members who took part in a post: [commenters, reactors, likers], each without duplicates of earlier lists.
async function postParticipants(postId, commenters){
  let uids = commenters;
  if(!uids){
    const snap = await getDocs(collection(db,'posts',postId,'comments')).catch(()=>null);
    uids = snap ? snap.docs.map(d=>d.data().uid) : [];
  }
  const post = await getDoc(doc(db,'posts',postId)).catch(()=>null);
  const data = post && post.exists() ? post.data() : {};
  const reactors = Object.values(data.reactions||{}).flat();
  const likers = effectiveVotes(data).up;
  return [uids, reactors, likers];
}

/*
 * kind: 'post' | 'comment' | 'reaction' | 'vote' | 'mentions' (only notify the mentions, e.g. after an edit).
 * postId and the post's author (postUid) identify the post; commentUid is set for a reaction on a comment.
 * text, mentions and mentionAll describe what was written; everyoneMessage replaces the default text for
 * new posts. commenters can be passed when already known; otherwise they are read when needed.
 */
export async function notifyFeedActivity({ kind, postId, postUid, commentUid, text, mentions, mentionAll, everyoneMessage, commenters }){
  try{
    const actor = myProfile.name;
    const snip = snippet(text);
    const quoted = snip ? `: "${snip}"` : '';
    const where = kind==='post' || kind==='mentions' ? 'bir gönderide' : 'bir yorumda';
    const recipients = new Map();
    const add = (uid, message, push = true)=>{
      if(!uid || uid===currentUid || recipients.has(uid)) return;
      const u = usersCache[uid];
      if(!u || u.banned || u.deleted) return;
      recipients.set(uid, { message, push });
    };
    const members = Object.keys(usersCache);

    (mentions||[]).forEach(uid=> add(uid, `${actor} ${where} seni andı${quoted}`));
    if(mentionAll && canMentionAll()) members.forEach(uid=> add(uid, `${actor} herkese seslendi${quoted}`));

    if(kind==='comment' || kind==='reaction' || kind==='vote'){
      if(kind==='reaction' && commentUid) add(commentUid, `${actor} yorumuna tepki verdi.`);
      const ownerMessage = kind==='comment' ? `${actor} gönderine yorum yaptı${quoted}`
        : kind==='vote' ? `${actor} gönderini beğendi.`
        : commentUid ? `${actor} gönderindeki bir yoruma tepki verdi.` : `${actor} gönderine tepki verdi.`;
      add(postUid, ownerMessage);
      const action = kind==='comment' ? `yorum yaptı${quoted}` : kind==='vote' ? 'beğendi.' : 'tepki verdi.';
      const [commented, reacted, liked] = await postParticipants(postId, commenters);
      const object = kind==='vote' ? 'gönderiyi' : 'gönderiye';
      commented.forEach(uid=> add(uid, `${actor} yorum yaptığın bir ${object} ${action}`));
      reacted.forEach(uid=> add(uid, `${actor} tepki verdiğin bir ${object} ${action}`));
      liked.forEach(uid=> add(uid, `${actor} beğendiğin bir ${object} ${action}`));
    }

    if(feedBoostActive() && kind!=='mentions'){
      const message = kind==='post' ? (everyoneMessage || `${actor} yeni bir gönderi paylaştı${quoted}`)
        : kind==='comment' ? `${actor} bir gönderiye yorum yaptı${quoted}`
        : kind==='vote' ? `${actor} bir gönderiyi beğendi.` : `${actor} bir gönderiye tepki verdi.`;
      members.forEach(uid=> add(uid, message, kind==='post'));
    }

    await Promise.all([...recipients].map(([uid, { message, push }])=> notifyUser(uid, message, 'social', postId, { push })));
  }catch(e){ console.error('Akış bildirimi gönderilemedi:', e); }
}

export async function createPost(type, data, forUid, forName){
  try{
    const ref = await addDoc(collection(db,'posts'), {
      type, uid: forUid||currentUid, name: forName||myProfile.name,
      createdAt: new Date().toISOString(), commentCount: 0,
      ...data
    });
    return ref.id;
  }catch(e){ console.error('Gönderi oluşturulamadı:', e); }
}
const BATCHABLE_TYPES = {
  book_review: { batchType:'book_review_batch', extract:(p)=>({ bookTitle:p.bookTitle, bookAuthor:p.bookAuthor, bookCover:p.bookCover, rating:p.rating, reviewText:p.reviewText, at:p.createdAt }) },
  book_added: { batchType:'book_added_batch', extract:(p)=>({ bookTitle:p.bookTitle, bookAuthor:p.bookAuthor, bookCover:p.bookCover, at:p.createdAt }) }
};
export async function deleteReadPostsRetroactively(){
  if(!confirm('Akıştaki tüm geçmiş "okudum" gönderileri silinecek. Bu geri alınamaz. Devam edilsin mi?')) return;
  const resultEl = document.getElementById('settingsDeleteReadPostsResult');
  if(resultEl) resultEl.textContent = window.BH_I18N.pick("Taranıyor…","Scanning…");
  showToast('Geçmiş "okudum" gönderileri taranıyor…');
  try{
    const snap = await getDocs(query(collection(db,'posts'), where('type','==','read')));
    const ids = [];
    snap.forEach(d=> ids.push(d.id));
    await Promise.all(ids.map(id=> deleteDoc(doc(db,'posts',id))));
    if(resultEl) resultEl.textContent = `${ids.length} "okudum" gönderisi silindi.`;
    showToast(`${ids.length} "okudum" gönderisi silindi.`);
    renderTimelineTab();
    renderPinnedPostBar();
  }catch(e){
    console.error('Okudum gönderileri silinemedi:', e);
    if(resultEl) resultEl.textContent = window.BH_I18N.pick("Silinirken bir hata oluştu.","An error occurred while deleting.");
    showToast(window.BH_I18N.pick("Silinirken bir hata oluştu.","An error occurred while deleting."));
  }
}
export async function migrateBatchPostsRetroactively(){
  if(!confirm('Bu işlem, geçmişteki tekli kitap puanlama/ekleme gönderilerinden aynı kişiye ait ve birbirine 1 saatten yakın olanları birleştirecek. Bu geri alınamaz (birleşenler silinip tek gönderiye dönüşür). Devam edilsin mi?')) return;
  showToast('Geçmiş gönderiler taranıyor…');
  try{
    const snap = await getDocs(query(collection(db,'posts'), where('type','in',['book_review','book_added'])));
    const posts = [];
    snap.forEach(d=> posts.push({id:d.id, ...d.data()}));
    const groups = {};
    posts.forEach(p=>{
      const key = p.uid+'|'+p.type;
      if(!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    let mergedPostCount = 0, groupCount = 0;
    async function commitChain(chain){
      if(chain.length<2) return;
      groupCount++;
      mergedPostCount += chain.length;
      const type = chain[0].type;
      const cfg = BATCHABLE_TYPES[type];
      const items = chain.map(p=> cfg.extract(p));
      const last = chain[chain.length-1];
      await updateDoc(doc(db,'posts',last.id), { type: cfg.batchType, items, createdAt: last.createdAt });
      await Promise.all(chain.slice(0,-1).map(p=> deleteDoc(doc(db,'posts',p.id))));
    }
    for(const key in groups){
      const arr = groups[key].slice().sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
      let chain = [arr[0]];
      for(let i=1;i<arr.length;i++){
        const prev = chain[chain.length-1];
        const gapMs = new Date(arr[i].createdAt) - new Date(prev.createdAt);
        if(gapMs <= 60*60*1000){
          chain.push(arr[i]);
        } else {
          await commitChain(chain);
          chain = [arr[i]];
        }
      }
      await commitChain(chain);
    }
    showToast(window.BH_I18N.template`Tamamlandı! ${groupCount} grup birleştirildi (${mergedPostCount} eski gönderi).`);
    if(activeTab==='social') renderTimelineTab();
  }catch(err){ alert('Hata: '+(err.message||err)); }
}
export async function createOrBatchPost(singleType, itemData){
  const cfg = BATCHABLE_TYPES[singleType];
  try{
    const oneHourAgoMs = Date.now() - 60*60*1000;
    const snap = await getDocs(query(collection(db,'posts'), where('uid','==',currentUid), limit(30)));
    let candidates = [];
    snap.forEach(d=>{
      const data = d.data();
      if(data.type===singleType || data.type===cfg.batchType) candidates.push({id:d.id, ...data});
    });
    candidates.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
    const existing = candidates[0];
    const isRecent = existing && (new Date(existing.createdAt).getTime() >= oneHourAgoMs);
    const itemWithTime = { ...itemData, at: new Date().toISOString() };
    if(existing && isRecent){
      if(existing.type === cfg.batchType){
        const newItems = [...(existing.items||[]), itemWithTime];
        await updateDoc(doc(db,'posts',existing.id), { items:newItems, createdAt:new Date().toISOString() });
      } else {
        const firstItem = cfg.extract(existing);
        const newItems = [firstItem, itemWithTime];
        await updateDoc(doc(db,'posts',existing.id), { type: cfg.batchType, items:newItems, createdAt:new Date().toISOString() });
      }
      return;
    }
    await createPost(singleType, itemData);
  }catch(e){
    console.error('Gönderi birleştirilemedi, tekli oluşturuluyor:', e);
    await createPost(singleType, itemData);
  }
}
function exactTimeLabel(iso){
  const d = new Date(iso);
  const months = [window.BH_I18N.pick("Ocak","January"),window.BH_I18N.pick("Şubat","February"),window.BH_I18N.pick("Mart","March"),window.BH_I18N.pick("Nisan","April"),window.BH_I18N.pick("Mayıs","May"),window.BH_I18N.pick("Haziran","June"),window.BH_I18N.pick("Temmuz","July"),window.BH_I18N.pick("Ağustos","August"),window.BH_I18N.pick("Eylül","September"),window.BH_I18N.pick("Ekim","October"),window.BH_I18N.pick("Kasım","November"),window.BH_I18N.pick("Aralık","December")];
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
function timeAgoLabel(iso){
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs/60000);
  if(mins < 1) return window.BH_I18N.pick("az önce","just now");
  if(mins < 60) return window.BH_I18N.template`${mins} dk önce`;
  const hrs = Math.floor(mins/60);
  if(hrs < 24) return window.BH_I18N.template`${hrs} sa önce`;
  const days = Math.floor(hrs/24);
  if(days < 10) return window.BH_I18N.template`${days} gün önce`;
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`;
}
/*
 * Every post has a bold title above its body. Members write their own titles (p.title); system posts
 * and polls get a generated one. In English, titles of automatic posts are translated when rendered;
 * stored posts and member-written text are never changed.
 */
function automaticPostTitleEn(p){
 const titles={read:'✓ Read today',skip:'😴 Missed reading',badge_gained:'🏅 Badge earned',badge_lost:'💔 Badge lost',gift_won:'🎁 Book gift won',gift_requested:'📮 Gift request',gift_completed:'🎉 Gift received',new_member:'👋 New member',book_review:'⭐ Book rated',book_review_batch:'⭐ Book ratings',book_added:'📖 Added to library',book_added_batch:'📖 Added to library',record_dethrone:'👑 New record',no_lottery:'🍀 No draw needed',rec_personal:'💡 Book recommendation',rec_group:'💡 Club recommendation'};
 const quarterly={nominations_open:'📚 Nominations open',nominations_near_end:'⏰ Nominations closing',objecting_open:'🔎 Objections open',objecting_near_end:'⏰ Objections closing',objection_made:'🙅 Objection submitted',nomination_made:'📖 New nomination',round_start:'🗳️ Voting round started',round_near_end:'⏰ Voting closing',round_result:'📊 Round results',final_winner:'🏆 Shared book selected',gift_lottery_drawn:'🎁 Gift draw completed',gift_lottery_applied:'🎁 Shared book gifts confirmed',discussion_opened:'💬 Discussion opened'};
 return p.type==='quarterly_pick'?(quarterly[p.subtype]||'📚 Shared book'):(titles[p.type]??null);
}
function automaticPostBodyEn(p){
 const book=escapeHtml(p.bookTitle||'');
 const cover=p.bookCover?`<img src="${escapeHtml(p.bookCover)}" alt="" class="post-book-cover book-cover-clickable" data-book-title="${escapeHtml((p.bookAuthor?p.bookAuthor+' - ':'')+(p.bookTitle||''))}" data-book-cover="${escapeHtml(p.bookCover)}" />`:'';
 const bookRow=text=>`<div style="display:flex;gap:10px;align-items:center;">${cover}<div style="min-width:0;">${text}</div></div>`;
 const quantity=(n,one,many)=>`${escapeHtml(String(n))} ${n===1?one:many}`;
 const badgeDef=BADGE_DEFS.find(b=>b.key===p.badgeKey);
 const badge=badgeDef?`${badgeDef.days}-day reading streak badge`:'reading streak badge';
 switch(p.type){
  case 'read':return '📖 Read today.';
  case 'skip':return '😴 Did not read today.';
  case 'badge_gained':return `🏅 Earned the <b>${escapeHtml(badge)}</b>!`;
  case 'badge_lost':return `💔 Lost the <b>${escapeHtml(badge)}</b>.`;
  case 'gift_won':return '🎁 Won a book gift in the draw!';
  case 'gift_requested':return `📮 Requested <b>${book}</b> from ${userChipHtml(p.giverUid)}.`;
  case 'gift_completed':return '🎉 Received their book gift!';
  case 'new_member':return '👋 Joined the club. Welcome!';
  case 'book_review':return bookRow(`<b>${book}</b><div style="color:var(--gold);font-size:13px;margin:2px 0;">⭐ Rated ${escapeHtml(String(p.rating??''))}/10</div>${p.reviewText?`<div class="muted" style="font-size:13px;">“${escapeHtml(p.reviewText)}”</div>`:''}`);
  case 'book_review_batch':return `⭐ Rated ${quantity((p.items||[]).length,'book','books')}. <span class="muted" style="font-size:12px;">(tap for details)</span>`;
  case 'book_added':return bookRow(`📖 Added <b>${book}</b> to their library.`);
  case 'book_added_batch':return `📖 Added ${quantity((p.items||[]).length,'book','books')} to their library. <span class="muted" style="font-size:12px;">(tap for details)</span>`;
  case 'record_dethrone':return `👑 Surpassed <b>${escapeHtml(p.dethronedName||'')}</b> in <b>${escapeHtml(window.BH_I18N.label(p.recordLabel||'record total'))}</b>: ${escapeHtml(String(p.recordCount??''))}.`;
  case 'no_lottery':return `🍀 No penalties this week${p.weekLabel?` (${escapeHtml(p.weekLabel)})`:''}, so no draw was needed!`;
  case 'rec_personal':return `✎ Recommended a book to <b>${escapeHtml(p.toName||'')}</b>.`;
  case 'rec_group':return bookRow(`✎ Recommended <b>${book}</b> to the club.`);
  case 'quarterly_pick':{
   switch(p.subtype){
    case 'nominations_open':return `📚 Nominations for the next shared book are open! Nominate up to 3 books over ${quantity(p.days||2,'day','days')} in the shared book selection section.`;
    case 'nominations_near_end':return '⏰ Only 2 hours left to nominate a shared book. Add your nomination now!';
    case 'objecting_open':return '🔎 The 1-day objection period has started. If you have recently read a nominated book, submit an objection in the shared book selection section.';
    case 'objecting_near_end':return '⏰ The objection period ends in 2 hours.';
    case 'objection_made':return `<b>${escapeHtml(p.name||'')}</b> objected to <b>${book}</b> because they read it recently. The book was removed from the nominations.`;
    case 'nomination_made':return bookRow(`<b>${escapeHtml(p.name||'')}</b> nominated <b>${book}</b>${p.bookAuthor?` (${escapeHtml(p.bookAuthor)})`:''}.`);
    case 'round_start':{
     const round=p.round===p.totalRounds?'Final':p.round===p.totalRounds-1?'Semifinal':`Round ${escapeHtml(String(p.round??''))}`;
     return `${round} voting has started${p.matchCount?` with ${quantity(p.matchCount,'match','matches')}`:''}! Vote in the shared book selection section.`;
    }
    case 'round_near_end':return '⏰ Voting in this round ends in 2 hours.';
    case 'round_result':return `This round has ended! Advancing to the next round: ${(p.results||[]).map(r=>escapeHtml(r.title||'')).join(', ')}.`;
    case 'final_winner':return `🏆 Our shared book is <b>${book}</b>! We will read it over the next 3 months.`;
    case 'discussion_opened':return `💬 Discussion is open for <b>${book}</b>! Submit the completion form to see everyone’s answers and join the conversation.`;
    case 'gift_lottery_drawn':return `🎁 The draw for members who did not finish the shared book is complete. ${quantity(p.pairCount||0,'member will','members will')} give a book. The gift book will be decided after the next shared book selection.`;
    case 'gift_lottery_applied':return `🎁 The shared book gifts have been confirmed: <b>${book}</b>! See the Gifts section for details.`;
    default:return 'Shared book selection updated.';
   }
  }
  default:return null;
 }
}

function postTitleFor(p){
  if(window.BH_I18N.language==='en'){const title=automaticPostTitleEn(p);if(title!==null)return title;}

  if(p.type==='user_post') return p.title ? escapeHtml(p.title) : null;
  if(p.type==='poll') return `📊 ${escapeHtml(p.question||window.BH_I18N.pick("Anket","Poll"))}`;
  if(p.type==='daily_questions') return window.BH_I18N.pick('Günün Soruları','Questions of the day');
  const T = {
    read: '✓ Bugün Okudu',
    skip: '😴 Bugün Okuyamadı',
    badge_gained: '🏅 Rozet Kazandı',
    badge_lost: '💔 Rozet Kaybetti',
    gift_won: '🎁 Hediye Kazandı',
    gift_requested: '📮 Hediye İsteği',
    gift_completed: '🎉 Hediyeye Kavuştu',
    new_member: '👋 Yeni Üye',
    book_review: '⭐ Kitap Puanladı',
    book_review_batch: '⭐ Kitap Puanlamaları',
    book_added: '📖 Kitaplığa Ekledi',
    book_added_batch: '📖 Kitaplığa Ekledi',
    record_dethrone: '👑 Rekor Kırıldı',
    no_lottery: '🍀 Kura Çekilmedi',
    rec_personal: '💡 Kitap Önerdi',
    rec_group: '💡 Gruba Öneri',
  };
  if(p.type==='quarterly_pick'){
    const QT = {
      nominations_open: '📚 Öneriler Başladı',
      nominations_near_end: '⏰ Öneri Süresi Bitiyor',
      objecting_open: '🔎 İtiraz Süresi Başladı',
      objecting_near_end: '⏰ İtiraz Süresi Bitiyor',
      objection_made: '🙅 İtiraz Edildi',
      nomination_made: '📖 Yeni Öneri',
      round_start: '🗳️ Oylama Turu Başladı',
      round_near_end: '⏰ Tur Bitiyor',
      round_result: '📊 Tur Sonuçlandı',
      final_winner: '🏆 Ortak Kitap Seçildi',
      gift_lottery_drawn: '🎁 Hediye Kurası Çekildi',
      gift_lottery_applied: '🎁 Ortak Kitap Hediyeleri Belli Oldu',
      discussion_opened: '💬 Tartışma Açıldı',
    };
    return QT[p.subtype] || '📚 Ortak Kitap';
  }
  return T[p.type] || null;
}
function postBodyHtml(p, expanded){
  if(window.BH_I18N.language==='en'){const body=automaticPostBodyEn(p);if(body!==null)return body;}

  const name = escapeHtml(p.name||'');
  switch(p.type){
    case 'read': return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px; margin-right:5px; flex:0 0 auto;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>${p.variantText ? escapeHtml(p.variantText) : window.BH_I18N.pick("Bugün okudu.","Read today.")}`;
    case 'skip': return p.variantText ? escapeHtml(p.variantText) : `😴 Bugün okuyamadı.`;
    case 'badge_gained': return p.variantText ? escapeHtml(p.variantText) : `${p.badgeIcon||'🏅'} <b>${escapeHtml(p.badgeLabel||'')}</b> rozetini kazandı!`;
    case 'badge_lost': return p.variantText ? escapeHtml(p.variantText) : `💔 <b>${escapeHtml(p.badgeLabel||'')}</b> rozetini kaybetti.`;
    case 'gift_won': return p.variantText ? escapeHtml(p.variantText) : `🎁 Bu hafta hediye kitap kazandı!`;
    case 'gift_requested': return `📮 ${userChipHtml(p.giverUid)} kişisinden <b>${escapeHtml(p.bookTitle||'')}</b> istedi.`;
    case 'gift_completed': return p.variantText ? escapeHtml(p.variantText) : `🎉 Hediye kitabına kavuştu!`;
    case 'new_member': return `👋 Kulübe katıldı, hoş geldin!`;
    case 'book_review': {
      const cover = p.bookCover ? `<img src="${p.bookCover}" alt="" class="post-book-cover book-cover-clickable" data-book-title="${escapeHtml((p.bookAuthor?p.bookAuthor+' - ':'')+(p.bookTitle||''))}" data-book-cover="${escapeHtml(p.bookCover)}" />` : '';
      return `<div style="display:flex; gap:10px;">${cover}<div style="min-width:0;"><b>${escapeHtml(p.bookTitle||'')}</b><div style="color:var(--gold); font-size:13px; margin:2px 0;">⭐ ${p.rating}/10 verdi</div>${p.reviewText?`<div class="muted" style="font-size:13px;">"${escapeHtml(p.reviewText)}"</div>`:''}</div></div>`;
    }
    case 'book_review_batch': return window.BH_I18N.template`⭐ ${(p.items||[]).length} kitap puanlaması yaptı. <span class="muted" style="font-size:12px;">(detaylar için tıkla)</span>`;
    case 'user_post': {
      const txt = p.text ? highlightMentions(escapeHtml(p.text), p.mentions, p.mentionAll).replace(/\n/g,'<br/>') : '';
      if(p.readingNote){
        const book = p.noteBook ? `<div class="reading-note-book">${escapeHtml(p.noteBook)}</div>` : '';
        return `${book}<blockquote class="reading-note-text">${txt}</blockquote>`;
      }
      const img = p.image ? `<img src="${p.image}" alt="" style="max-width:100%; border-radius:10px; margin-top:8px; display:block;" />` : '';
      return `${txt}${img}`;
    }
    case 'book_added': {
      const cover = p.bookCover ? `<img src="${p.bookCover}" alt="" class="post-book-cover book-cover-clickable" data-book-title="${escapeHtml((p.bookAuthor?p.bookAuthor+' - ':'')+(p.bookTitle||''))}" data-book-cover="${escapeHtml(p.bookCover)}" />` : '';
      const addedSuffix = turkishAccusativeName(p.bookTitle||'').split("'").pop();
      return window.BH_I18N.template`<div style="display:flex; gap:10px; align-items:center;">${cover}<div>📖 Kitaplığına <b>${escapeHtml(p.bookTitle||'')}</b>'${addedSuffix} ekledi.</div></div>`;
    }
    case 'book_added_batch': return window.BH_I18N.template`📖 Kitaplığına ${(p.items||[]).length} kitap ekledi. <span class="muted" style="font-size:12px;">(detaylar için tıkla)</span>`;
    case 'record_dethrone': return `👑 ${p.recordIcon||'🏆'} <b>${escapeHtml(p.recordLabel||'')}</b> rekorunda <b>${escapeHtml(p.dethronedName||'')}</b>'ı geçti! (${p.recordCount})`;
    case 'no_lottery': return `🍀 Bu hafta (${escapeHtml(p.weekLabel||'')}) kimse cezalı olmadı, kura çekilmedi!`;
    case 'rec_personal': return `✎ ${turkishDativeName(escapeHtml(p.toName||''))} kitap önerdi.`;
    case 'rec_group': {
      const cover = p.bookCover ? `<img src="${p.bookCover}" alt="" class="post-book-cover book-cover-clickable" data-book-title="${escapeHtml(p.bookTitle||'')}" data-book-cover="${escapeHtml(p.bookCover)}" />` : '';
      const recSuffix = turkishAccusativeName(p.bookTitle||'').split("'").pop();
      return window.BH_I18N.template`<div style="display:flex; gap:10px; align-items:center;">${cover}<div>✎ Gruba <b>${escapeHtml(p.bookTitle||'')}</b>'${recSuffix} önerdi.</div></div>`;
    }
    case 'poll': return pollBodyHtml(p, expanded);
    case 'daily_questions': return dailyQuestionsPostBodyHtml(p);
    case 'quarterly_pick': {
      const sub = p.subtype;
      if(sub==='nominations_open') return `📚 Yeni ortak kitap önerileri başladı! ${p.days||2} gün içinde en fazla 3 kitap önerebilirsin. "Kulüp → Ortak kitap" bölümünden katılabilirsin.`;
      if(sub==='nominations_near_end') return `⏰ Ortak kitap önerileri için son 2 saat! Önerecek kitabın varsa şimdi ekle.`;
      if(sub==='objecting_open') return `🔎 1 günlük itiraz süresi başladı — bir kitabı yakın zamanda okuduysan "Kulüp → Ortak kitap" bölümünden itiraz edebilirsin.`;
      if(sub==='objecting_near_end') return `⏰ İtiraz süresi bitmek üzere (2 saat kaldı).`;
      if(sub==='objection_made') return `<b>${escapeHtml(p.name||'')}</b>, "${escapeHtml(p.bookTitle||'')}" kitabına itiraz etti (yakın zamanda okumuş) — öneriden düştü.`;
      if(sub==='nomination_made'){
        const cover = p.bookCover
          ? `<img src="${p.bookCover}" alt="" class="post-book-cover book-cover-clickable" data-book-title="${escapeHtml(p.bookTitle||'')}" data-book-cover="${escapeHtml(p.bookCover)}" />`
          : `<span class="post-book-cover" style="display:inline-block; overflow:hidden; border-radius:6px;">${materialBookCover(p.bookTitle,'')}</span>`;
        return window.BH_I18N.template`<div style="display:flex; gap:10px; align-items:center;">${cover}<div><b>${escapeHtml(p.name||'')}</b> bir kitap önerdi: <b>${escapeHtml(p.bookTitle||'')}</b>${p.bookAuthor?` (${escapeHtml(p.bookAuthor)})`:''}</div></div>`;
      }
      if(sub==='round_start'){
        const label = p.round===p.totalRounds ? 'Final' : (p.round===(p.totalRounds-1) ? window.BH_I18N.pick("Yarı final","Semifinal") : `${p.round}. tur`);
        return `${label} oylaması başladı! ${p.matchCount||''} eşleşme var, "Kulüp → Ortak kitap" bölümünden oy verebilirsin.`;
      }
      if(sub==='round_near_end') return window.BH_I18N.template`Bu turun oylaması bitmek üzere (2 saat kaldı).`;
      if(sub==='round_result'){
        const winners = (p.results||[]).map(r=>escapeHtml(r.title)).join(', ');
        return `Tur sona erdi! Bir üst tura geçenler: ${winners}`;
      }
      if(sub==='final_winner') return `Ortak kitap seçildi: <b>"${escapeHtml(p.bookTitle||'')}"</b>! 3 ay boyunca bunu okuyacağız.`;
      if(sub==='discussion_opened') return `"${escapeHtml(p.bookTitle||'')}" için tartışma açıldı! Bitirme formunu doldurduysan herkesin cevaplarını görebilir, sohbete katılabilirsin.`;
      if(sub==='gift_lottery_drawn') return `Ortak kitabı bitirmeyenler için hediye kurası çekildi (${p.pairCount||0} kişi hediye verecek) — hangi kitap olacağı bir sonraki ortak kitap seçimi tamamlanınca belli olacak.`;
      if(sub==='gift_lottery_applied') return `Ortak kitap hediyeleri belli oldu: <b>"${escapeHtml(p.bookTitle||'')}"</b>! "Hediye Kitap" sekmesinden bakabilirsin.`;
      return window.BH_I18N.pick("Ortak kitap seçimi güncellendi.","Shared book selection updated.");
    }
    default: return escapeHtml(p.text||'');
  }
}
/*
 * Poll body: each option is a clickable row with a bar filled by its share of the votes; the user's own
 * vote is highlighted and the total is shown below.
 */
function pollVoterAvatarsHtml(voters){
  if(!voters || !voters.length) return '';
  const maxShow = 4;
  const shown = voters.slice(0, maxShow);
  const extra = voters.length - maxShow;
  const circles = shown.map((uid,i)=>{
    const u = usersCache[uid] || {};
    const name = u.name || '?';
    const inner = profilePhotoHtml(u, 9);
    return `<span class="poll-voter-avatar" style="z-index:${maxShow-i};" title="${escapeHtml(name)}">${inner}</span>`;
  }).join('');
  const extraHtml = extra>0 ? `<span class="poll-voter-avatar poll-voter-extra">+${extra}</span>` : '';
  return `<div class="poll-option-voters">${circles}${extraHtml}</div>`;
}
function pollBodyHtml(p, expanded){
  const options = p.options || [];
  const totalVotes = options.reduce((sum,o)=> sum + (o.voters||[]).length, 0);
  const myVoteIdx = options.findIndex(o=> (o.voters||[]).includes(currentUid));
  const rows = options.map((o,i)=>{
    const count = (o.voters||[]).length;
    const pct = totalVotes>0 ? Math.round(count/totalVotes*100) : 0;
    const voted = i===myVoteIdx;
    /*
     * Voter avatars (in voting order) are only shown on the expanded post, not on the small card in the
     * feed.
     */
    const voterAvatars = expanded ? pollVoterAvatarsHtml(o.voters) : '';
    return `<div class="poll-option-row${voted?' voted':''}" data-poll-post="${p.id}" data-poll-option="${i}">
      <div class="poll-option-fill" style="width:${pct}%;"></div>
      <div class="poll-option-content">
        <span class="poll-option-text">${voted?'✓ ':''}${escapeHtml(o.text)}</span>
        <div class="poll-option-right">
          ${voterAvatars}
          <span class="poll-option-pct">${totalVotes>0?pct+'%':''}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  const img = p.image ? `<img src="${p.image}" alt="" style="max-width:100%; border-radius:10px; margin-bottom:8px; display:block;" />` : '';
  return `${img}${rows}<div class="poll-total-votes">${totalVotes} oy</div>`;
}
async function voteOnPoll(postId, optionIdx){
  if(!postId || Number.isNaN(optionIdx)) return;
  try{
    await runTransaction(db, async (tx)=>{
      const ref = doc(db,'posts',postId);
      const snap = await tx.get(ref);
      if(!snap.exists()) return;
      const data = snap.data();
      const options = (data.options||[]).map(o=> ({...o, voters:[...(o.voters||[])]}));
      const alreadyVotedIdx = options.findIndex(o=> o.voters.includes(currentUid));
      if(alreadyVotedIdx===optionIdx){
        // Tapping the option you voted for again withdraws the vote.
        options[optionIdx].voters = options[optionIdx].voters.filter(u=>u!==currentUid);
      } else {
        if(alreadyVotedIdx!==-1) options[alreadyVotedIdx].voters = options[alreadyVotedIdx].voters.filter(u=>u!==currentUid);
        options[optionIdx].voters.push(currentUid);
      }
      tx.update(ref, {options});
    });
  }catch(e){ console.error('Oy verilemedi:', e); alert('Oy verilemedi: '+(e.message||e)); }
}
function isPostPinned(p){
  return !!(p.pinnedUntil && new Date(p.pinnedUntil).getTime() > Date.now());
}
function myReactionEmoji(reactions){
  if(!reactions) return null;
  for(const em of Object.keys(reactions)){
    if((reactions[em]||[]).includes(currentUid)) return em;
  }
  return null;
}
// Briefly bounces the reaction pill of a post after the user reacts.
export function burstMyReactionBadge(target){
  const badge = document.querySelector(`[data-target="${target}"].reaction-add-btn`) || document.querySelector(`.my-reaction-badge[data-target="${target}"]`);
  if(badge){ badge.classList.add('reaction-burst'); setTimeout(()=>badge.classList.remove('reaction-burst'), 300); }
}
/*
 * Up and down votes of a post. The author of a member post counts as having up-voted it from the start,
 * so a new post shows 1. The first vote on the post stores that implicit vote (votesSeeded), after which
 * the author can take it back like any other vote.
 */
function effectiveVotes(p){
  const up = [...((p.votes && p.votes.up) || [])];
  const down = [...((p.votes && p.votes.down) || [])];
  if(MEMBER_POST_TYPES.includes(p.type) && !p.votesSeeded && p.uid && !up.includes(p.uid) && !down.includes(p.uid)) up.push(p.uid);
  return { up, down };
}
// Up/down vote pill for posts (comments and recommendations use emoji reactions only).
function postVoteRowHtml(p){
  const { up, down } = effectiveVotes(p);
  const score = up.length - down.length;
  const myUp = up.includes(currentUid), myDown = down.includes(currentUid);
  return window.BH_I18N.template`<div class="post-vote-row" data-vote-rail="${p.id}">
    <button type="button" class="post-vote-btn up${myUp?' active':''}" data-vote-post="${p.id}" data-dir="up" title="Beğen">▲</button>
    <span class="post-vote-score${myUp?' voted-up':myDown?' voted-down':''}" data-vote-score>${score}</span>
    <button type="button" class="post-vote-btn down${myDown?' active':''}" data-vote-post="${p.id}" data-dir="down" title="Beğenme">▼</button>
  </div>`;
}
/*
 * Compact emoji reaction pill next to the vote pill: shows your own reaction, if any, and opens the
 * reaction picker on tap.
 */
function postReactionPillHtml(p){
  const reactions = p.reactions || {};
  const myReaction = myReactionEmoji(reactions);
  const totalCount = Object.values(reactions).reduce((sum,arr)=> sum + ((arr&&arr.length)||0), 0);
  return `<button type="button" class="post-action-btn reaction-add-btn" data-target="post:${p.id}">${myReaction||'🙂'}${totalCount>0?` ${totalCount}`:''}</button>`;
}
// Update the vote pill immediately; the Firestore write runs in the background.
function applyOptimisticVoteUI(railEl, dir){
  const upBtn = railEl.querySelector('.post-vote-btn.up');
  const downBtn = railEl.querySelector('.post-vote-btn.down');
  const scoreEl = railEl.querySelector('[data-vote-score]');
  let score = parseInt(scoreEl.textContent,10) || 0;
  const wasUp = upBtn.classList.contains('active');
  const wasDown = downBtn.classList.contains('active');
  if(dir==='up'){
    if(wasUp){ score -= 1; upBtn.classList.remove('active'); }
    else { score += wasDown ? 2 : 1; upBtn.classList.add('active'); downBtn.classList.remove('active'); }
  } else {
    if(wasDown){ score += 1; downBtn.classList.remove('active'); }
    else { score -= wasUp ? 2 : 1; downBtn.classList.add('active'); upBtn.classList.remove('active'); }
  }
  scoreEl.textContent = score;
  scoreEl.classList.remove('voted-up','voted-down');
  if(upBtn.classList.contains('active')) scoreEl.classList.add('voted-up');
  if(downBtn.classList.contains('active')) scoreEl.classList.add('voted-down');
}
function wireVoteButtons(container){
  container.querySelectorAll('.post-vote-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const postId = btn.dataset.votePost;
      const dir = btn.dataset.dir;
      const rail = btn.closest('[data-vote-rail]');
      applyOptimisticVoteUI(rail, dir);
      setPostVote(postId, dir);
    });
  });
}
async function setPostVote(postId, dir){
  const ref = doc(db,'posts',postId);
  let notifyUid = null;
  try{
    await runTransaction(db, async(tx)=>{
      const snap = await tx.get(ref);
      if(!snap.exists()) return;
      const data = snap.data();
      const votes = effectiveVotes(data);
      const up = votes.up.filter(u=>u!==currentUid);
      const down = votes.down.filter(u=>u!==currentUid);
      const wasUp = votes.up.includes(currentUid);
      const wasDown = votes.down.includes(currentUid);
      if(dir==='up' && !wasUp) up.push(currentUid);
      if(dir==='down' && !wasDown) down.push(currentUid);
      tx.update(ref, {'votes.up':up, 'votes.down':down, votesSeeded:true});
      // The author re-adding their own vote is not news for anyone.
      if(dir==='up' && !wasUp && data.uid!==currentUid) notifyUid = data.uid || '';
    });
    if(notifyUid!==null) notifyFeedActivity({ kind:'vote', postId, postUid: notifyUid });
  }catch(err){ alert('Oy verilemedi: '+(err.message||err)); }
}
/*
 * Visual weight of a post: member posts are the largest, book added/rated posts medium, everything else
 * (badges, gifts, system posts) default size.
 */
function postWeightClass(p){
  if(p.type==='user_post') return 'weight-high';
  if(p.type==='book_review' || p.type==='book_review_batch' || p.type==='book_added' || p.type==='book_added_batch') return 'weight-medium';
  return '';
}
export function renderPostCard(p){
  const canDelete = p.uid===currentUid || myProfile.role==='admin';
  const canEdit = p.uid===currentUid && p.type==='user_post';
  const pinned = isPostPinned(p);
  return window.BH_I18N.template`<div class="post-card ${postWeightClass(p)} modal-card-anim" data-post-id="${p.id}">
    <div class="post-inner">
      <div class="post-card-head">
        ${userChipHtml(p.uid)}
        <span class="post-card-time">&middot; ${timeAgoLabel(p.createdAt)}</span>
        ${pinned?`<span title="Sabitlenmiş" style="margin-left:auto; font-size:13px;">📌</span>`:''}
        ${canDelete?`<button type="button" class="post-menu-btn" data-post-menu="${p.id}" data-can-edit="${canEdit?'1':'0'}" data-is-pinned="${pinned?'1':'0'}" style="${pinned?'':'margin-left:auto;'}" title="Seçenekler">⋮</button>`:''}
      </div>
      <div class="post-card-body">${(()=>{const t=postTitleFor(p); return t?`<div class="post-title">${t}</div>`:'';})()}${postBodyHtml(p)}</div>
      <div class="post-actions">
        ${postVoteRowHtml(p)}
        <button type="button" class="post-action-btn post-comment-inline-btn" data-post-id="${p.id}"><span class="post-comment-count">💬 ${p.commentCount||0}</span></button>
        ${postReactionPillHtml(p)}
      </div>
      <div class="post-comments-panel" data-post-id="${p.id}" data-post-uid="${p.uid||''}" data-comment-count="${p.commentCount||0}">
        <div class="rec-comments-label">💬 Yorumlar</div>
        <div class="post-comments-list"><span class="muted">Yükleniyor…</span></div>
        <div class="row" style="margin-top:10px;">
          <input type="text" class="post-comment-inline-input" placeholder="Yorum yaz..." data-mentions />
          <button type="button" class="secondary tiny post-comment-inline-send" style="flex:0 0 auto;">Gönder</button>
        </div>
      </div>
    </div>
  </div>`;
}
let timelinePostDocs = [];
let timelineAllPosts = [];
let timelineOlderClicks = 0;
const TIMELINE_PAGE_SIZE = 50;

/*
 * The feed has two views: "members" (shown as "Kulüp") lists what members wrote themselves (posts, polls,
 * reading notes and daily-question answers) under the daily questions card; "club" (shown as
 * "Etkinlikler") lists the automatic posts (badges, streak records, gifts, book ratings, shared-book news
 * and so on). Opening the feed tab always starts on "members".
 */
const MEMBER_POST_TYPES = ['user_post','poll','daily_questions'];
let timelineView = 'members';
let timelineLoadToken = 0;
const inTimelineView = (p)=> MEMBER_POST_TYPES.includes(p.type) === (timelineView==='members');

export function resetTimelineView(){ setTimelineView('members'); }

function setTimelineView(view){
  timelineView = view;
  document.querySelectorAll('#feedViewSwitch [data-feed-view]').forEach(b=>{
    const on = b.dataset.feedView===view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  const feedView = document.getElementById('socialFeedView');
  if(feedView) feedView.classList.toggle('club-view', view==='club');
}

/*
 * Reads one page of posts for the current view, newest first. The "members" view asks Firestore for the
 * member post types only; that query needs the (type, createdAt) index from firestore.indexes.json, and
 * until the index exists it falls back to reading all posts and filtering them here.
 */
async function fetchTimelinePage(...constraints){
  const posts = collection(db,'posts');
  if(timelineView==='members'){
    try{
      return (await getDocs(query(posts, where('type','in',MEMBER_POST_TYPES), orderBy('createdAt','desc'), ...constraints))).docs;
    }catch(e){
      if(e.code!=='failed-precondition') throw e;
      console.warn('Akış dizini henüz yok, gönderiler tarayıcıda süzülüyor.');
    }
  }
  return (await getDocs(query(posts, orderBy('createdAt','desc'), ...constraints))).docs;
}
function addTimelineDocs(docs){
  docs.forEach(d=>{ timelinePostDocs.push(d); const p = {id:d.id, ...d.data()}; if(inTimelineView(p)) timelineAllPosts.push(p); });
}

export async function renderTimelineTab(){
  renderPinnedPostBar();
  if(timelineView==='members') renderDailyQuestionsCard();
  const feed = document.getElementById('timelineFeed');
  const token = ++timelineLoadToken;
  const loading = `<div class="empty-state">${window.BH_I18N.pick("Yükleniyor…","Loading…")}</div>`;
  if(feed.dataset.view !== timelineView){
    feed.dataset.view = timelineView;
    delete feed.dataset.loaded;
    // Only the default "members" view keeps a saved copy for instant display on the next app start.
    if(timelineView!=='members'){ feed.innerHTML = loading; feed.dataset.loaded = '1'; }
  }
  keepOrLoading('timelineFeed');
  let docs;
  try{ docs = await fetchTimelinePage(limit(60)); }catch(e){ return; }
  if(token!==timelineLoadToken) return;
  timelinePostDocs = [];
  timelineAllPosts = [];
  timelineOlderClicks = 0;
  addTimelineDocs(docs);
  if(!timelineAllPosts.length && docs.length<60){
    feed.innerHTML = timelineEmptyHtml();
  } else {
    renderTimelineFeedHtml(feed);
  }
  if(timelineView==='members') markLoaded(feed); else feed.dataset.loaded = '1';
}
function timelineEmptyHtml(){
  return timelineView==='members'
    ? `<div class="empty-state">${window.BH_I18N.pick("Henüz paylaşım yok. İlk paylaşımı sen yapabilirsin.","Nothing shared yet. You can be the first to post.")}</div>`
    : window.BH_I18N.template`<div class="empty-state"><span class="big">📰</span>Henüz gönderi yok. Okuma işaretlemeleri, rozetler ve hediyeler burada görünecek.</div>`;
}
function renderTimelineFeedHtml(feed){
  let html = timelineAllPosts.length ? timelineAllPosts.map(p=> renderPostCard(p)).join('') : timelineEmptyHtml();
  if(timelineOlderClicks < 5){
    html += window.BH_I18N.template`<div style="text-align:center; padding:16px 0;"><button type="button" class="secondary" id="timelineLoadOlderBtn">⬇️ Daha Eski Gönderileri Gör</button></div>`;
  } else {
    html += window.BH_I18N.template`<div style="text-align:center; padding:16px 0;">
      <div class="muted" style="margin-bottom:8px; font-size:12.5px;">Daha eski gönderiler için bir tarih seç:</div>
      <input type="date" id="timelineJumpDateInput" style="margin-right:6px;" />
      <button type="button" class="secondary" id="timelineJumpDateBtn">Git</button>
    </div>`;
  }
  feed.innerHTML = html;
  wirePostCards(feed, renderTimelineTab);
  const olderBtn = document.getElementById('timelineLoadOlderBtn');
  if(olderBtn) olderBtn.addEventListener('click', async ()=>{
    olderBtn.disabled = true;
    olderBtn.textContent = window.BH_I18N.pick("Yükleniyor…","Loading…");
    const lastDoc = timelinePostDocs[timelinePostDocs.length-1];
    const token = timelineLoadToken;
    try{
      const docs = lastDoc ? await fetchTimelinePage(startAfter(lastDoc), limit(TIMELINE_PAGE_SIZE)) : [];
      if(token!==timelineLoadToken) return;
      addTimelineDocs(docs);
      timelineOlderClicks++;
      if(!docs.length) showToast(window.BH_I18N.pick("Gösterilecek daha eski gönderi kalmadı.","No older posts to show."));
      renderTimelineFeedHtml(feed);
    }catch(e){ alert(window.BH_I18N.pick("Yüklenemedi: ","Could not load: ")+(e.message||e)); olderBtn.disabled=false; olderBtn.textContent=window.BH_I18N.pick("⬇️ Daha Eski Gönderileri Gör","⬇️ View older posts"); }
  });
  const jumpBtn = document.getElementById('timelineJumpDateBtn');
  if(jumpBtn) jumpBtn.addEventListener('click', async ()=>{
    const dateVal = document.getElementById('timelineJumpDateInput').value;
    if(!dateVal){ alert(window.BH_I18N.pick("Önce bir tarih seç.","Select a date first.")); return; }
    jumpBtn.disabled = true;
    const token = timelineLoadToken;
    try{
      const cutoff = dateVal + 'T23:59:59.999Z';
      const docs = await fetchTimelinePage(where('createdAt','<=',cutoff), limit(60));
      if(token!==timelineLoadToken) return;
      timelinePostDocs = [];
      timelineAllPosts = [];
      timelineOlderClicks = 0;
      addTimelineDocs(docs);
      if(!timelineAllPosts.length){ showToast(window.BH_I18N.pick("Bu tarihten önce gönderi bulunamadı.","No posts found before this date.")); jumpBtn.disabled=false; return; }
      renderTimelineFeedHtml(feed);
      showToast(`${dateVal} tarihine gidildi.`);
    }catch(e){ alert('Gidilemedi: '+(e.message||e)); jumpBtn.disabled=false; }
  });
}
function openPostMenu(btn, postId, canEdit, refresh, isPinned){
  const isAdmin = myProfile.role==='admin';
  const html = window.BH_I18N.template`
    ${canEdit?window.BH_I18N.template`<button type="button" class="post-menu-item" id="postMenuEditBtn">✏️ Düzenle</button>`:''}
    ${isAdmin ? (isPinned ? window.BH_I18N.template`<button type="button" class="post-menu-item" id="postMenuUnpinBtn">📌 Pini Kaldır</button>` : `<button type="button" class="post-menu-item" id="postMenuPinBtn">📌 Pinle</button>`) : ''}
    <button type="button" class="post-menu-item danger" id="postMenuDeleteBtn">🗑 Kaldır</button>
  `;
  showAnchoredPopover(btn, html);
  const editBtn = document.getElementById('postMenuEditBtn');
  if(editBtn) editBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    openEditPostModal(postId, refresh);
  });
  const pinBtn = document.getElementById('postMenuPinBtn');
  if(pinBtn) pinBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    openPinDurationMenu(postId, refresh);
  });
  const unpinBtn = document.getElementById('postMenuUnpinBtn');
  if(unpinBtn) unpinBtn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    try{ await updateDoc(doc(db,'posts',postId), { pinnedUntil: null }); showToast(window.BH_I18N.pick("Sabitleme kaldırıldı.","Post unpinned.")); refresh(); renderPinnedPostBar(); }catch(err){ alert(window.BH_I18N.pick("Kaldırılamadı: ","Could not remove: ")+(err.message||err)); }
  });
  document.getElementById('postMenuDeleteBtn').addEventListener('click', async (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    if(!confirm(window.BH_I18N.pick("Bu gönderiyi silmek istediğine emin misin?","Are you sure you want to delete this post?"))) return;
    try{ await deleteDoc(doc(db,'posts',postId)); refresh(); renderPinnedPostBar(); }catch(err){ alert('Silinemedi: '+(err.message||err)); }
  });
}
function openPinDurationMenu(postId, refresh){
  const options = [
    {label:'30 dakika', mins:30},
    {label:'1 saat', mins:60},
    {label:'1 gün', mins:1440},
    {label:'1 ay', mins:43200},
    {label:'6 ay', mins:259200}
  ];
  showSimpleInfoModal(window.BH_I18N.template`<h2 style="margin-bottom:10px;">Ne Kadar Sabitlensin?</h2>
    <div style="display:flex; flex-direction:column; gap:4px;">
      ${options.map(o=>`<button type="button" class="post-menu-item" data-pin-mins="${o.mins}">${o.label}</button>`).join('')}
    </div>`);
  document.querySelectorAll('#bookInfoModalBody [data-pin-mins]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const mins = parseInt(b.dataset.pinMins,10);
      const until = new Date(Date.now() + mins*60000).toISOString();
      try{
        await updateDoc(doc(db,'posts',postId), { pinnedUntil: until });
        closeModal('bookInfoModal');
        showToast(window.BH_I18N.pick("Gönderi sabitlendi!","Post pinned!"));
        if(refresh) refresh();
        renderPinnedPostBar();
      }catch(err){ alert('Sabitlenemedi: '+(err.message||err)); }
    });
  });
}
async function renderPinnedPostBar(){
  const bar = document.getElementById('pinnedPostBar');
  if(!bar) return;
  let pinned = null;
  try{
    const snap = await getDocs(query(collection(db,'posts'), where('pinnedUntil','>', new Date().toISOString()), orderBy('pinnedUntil','desc'), limit(1)));
    snap.forEach(d=>{ pinned = {id:d.id, ...d.data()}; });
  }catch(e){ return; }
  if(!pinned){ bar.style.display='none'; bar.innerHTML=''; document.getElementById('timelineFeed').style.marginTop=''; return; }
  const previewText = (pinned.text || postBodyHtml(pinned).replace(/<[^>]+>/g,'')).slice(0,80);
  bar.innerHTML = `<span class="pin-icon">📌</span><span class="pin-author">${escapeHtml(usersCache[pinned.uid]?.name||'')}</span><span class="pin-preview">${escapeHtml(previewText)}</span>`;
  bar.style.display = 'flex';
  document.getElementById('timelineFeed').style.marginTop = '54px';
  positionPinnedPostBar();
  bar.onclick = ()=>{
    const card = document.querySelector(`.post-card[data-post-id="${pinned.id}"]`);
    if(card) card.scrollIntoView({behavior:'smooth', block:'center'});
    else openPostModal(pinned.id);
  };
}
export function positionPinnedPostBar(){
  const contentCol = document.getElementById('contentCol');
  const bar = document.getElementById('pinnedPostBar');
  if(!contentCol || !bar) return;
  const rect = contentCol.getBoundingClientRect();
  bar.style.left = (rect.left + 16) + 'px';
  bar.style.width = (rect.width - 32) + 'px';
}
function resizeImageToDataUrl(file, maxDim, quality){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w > maxDim || h > maxDim){
          if(w > h){ h = Math.round(h * maxDim/w); w = maxDim; }
          else { w = Math.round(w * maxDim/h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
let composeImageDataUrl = null;
/*
 * "Join the conversation" box: expands in place (no dialog) into title and text fields; the small "+"
 * button attaches an image.
 */
let jcImageDataUrl = null;
function jcExpand(){
  document.getElementById('joinConversationTrigger').style.display = 'none';
  const form = document.getElementById('joinConversationForm');
  form.style.display = 'block';
  document.getElementById('jcTitleInput').focus();
}
function jcCollapse(){
  document.getElementById('joinConversationTrigger').style.display = 'flex';
  document.getElementById('joinConversationForm').style.display = 'none';
  document.getElementById('jcTitleInput').value = '';
  document.getElementById('jcTextInput').value = '';
  document.getElementById('jcImageInput').value = '';
  jcImageDataUrl = null;
  document.getElementById('jcImagePreviewWrap').style.display = 'none';
}
async function openEditPostModal(postId, refresh){
  let p = null;
  try{ const snap = await getDoc(doc(db,'posts',postId)); if(snap.exists()) p = {id:postId, ...snap.data()}; }catch(e){}
  if(!p) return;
  composeImageDataUrl = p.image || null;
  showSimpleInfoModal(window.BH_I18N.template`
    <h2 style="margin-bottom:10px;">Gönderiyi Düzenle</h2>
    <input type="text" id="composeTitle" class="compose-poll-input" maxlength="100" placeholder="Başlık" value="${escapeHtml(p.title||'')}" style="margin-bottom:8px;" />
    <textarea id="composeText" class="compose-textarea" maxlength="280" data-mentions>${escapeHtml(p.text||'')}</textarea>
    <div class="muted" id="composeCharCount" style="text-align:right; font-size:11px; margin-top:2px;"></div>
    <div id="composeImagePreviewWrap" style="${p.image?'':'display:none;'} margin-top:10px; text-align:center;">
      <img id="composeImagePreview" src="${p.image||''}" style="max-width:100%; border-radius:10px;" />
      <button type="button" class="secondary tiny" id="composeImageRemoveBtn" style="margin-top:6px;">Görseli Kaldır</button>
    </div>
    <input type="file" id="composeImageInput" accept="image/*" style="display:none;" />
    <div class="row" style="margin-top:10px;">
      <button type="button" class="secondary tiny" id="composeImageBtn">📷 ${p.image?window.BH_I18N.pick("Görseli Değiştir","Change image"):window.BH_I18N.pick("Görsel Ekle","Add image")}</button>
      <button type="button" class="primary" id="composeSendBtn" style="flex:1;">Kaydet</button>
    </div>
  `);
  const textarea = document.getElementById('composeText');
  const counter = document.getElementById('composeCharCount');
  function updateLimit(){
    const max = composeImageDataUrl ? 140 : 280;
    textarea.maxLength = max;
    if(textarea.value.length > max) textarea.value = textarea.value.slice(0, max);
    counter.textContent = `${max - textarea.value.length} karakter kaldı`;
  }
  textarea.addEventListener('input', updateLimit);
  updateLimit();
  document.getElementById('composeImageBtn').addEventListener('click', ()=> document.getElementById('composeImageInput').click());
  document.getElementById('composeImageInput').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    try{
      composeImageDataUrl = await resizeImageToDataUrl(file, 800, 0.72);
      document.getElementById('composeImagePreview').src = composeImageDataUrl;
      document.getElementById('composeImagePreviewWrap').style.display='block';
      updateLimit();
    }catch(err){ alert(window.BH_I18N.pick("Görsel işlenemedi: ","Could not process image: ")+(err.message||err)); }
  });
  document.getElementById('composeImageRemoveBtn').addEventListener('click', ()=>{
    composeImageDataUrl = null;
    document.getElementById('composeImagePreviewWrap').style.display='none';
    document.getElementById('composeImageInput').value = '';
    updateLimit();
  });
  document.getElementById('composeSendBtn').addEventListener('click', async ()=>{
    const title = document.getElementById('composeTitle').value.trim();
    const text = textarea.value.trim();
    if(!title){ alert(window.BH_I18N.pick("Başlık yazmalısın.","Enter a title.")); return; }
    if(!text && !composeImageDataUrl){ alert(window.BH_I18N.pick("Bir şey yazmalısın veya görsel eklemelisin.","Write something or add an image.")); return; }
    try{
      const tagged = extractMentions(title, text);
      await updateDoc(doc(db,'posts',postId), { title, text, image: composeImageDataUrl||'', ...tagged });
      // Only members added by this edit are notified.
      const added = tagged.mentions.filter(uid=>!(p.mentions||[]).includes(uid));
      const addedAll = tagged.mentionAll && !p.mentionAll;
      if(added.length || addedAll) notifyFeedActivity({ kind:'mentions', postId, text: title, mentions: added, mentionAll: addedAll });
      closeModal('bookInfoModal');
      showToast(window.BH_I18N.pick("Gönderi güncellendi!","Post updated!"));
      refresh();
    }catch(err){ alert('Kaydedilemedi: '+(err.message||err)); }
  });
}
export function wirePostCards(container, refreshFn){
  const refresh = refreshFn || renderTimelineTab;
  fillDailyQuestionStats(container);
  container.querySelectorAll('[data-post-menu]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      openPostMenu(btn, btn.dataset.postMenu, btn.dataset.canEdit==='1', refresh, btn.dataset.isPinned==='1');
    });
  });
  wireVoteButtons(container);
  container.querySelectorAll('.reaction-add-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); setPendingReactionRefresh(refresh); toggleReactionDrawer(btn, btn.dataset.target); });
  });
  container.querySelectorAll('[data-poll-option]').forEach(row=>{
    row.addEventListener('click', async (e)=>{
      e.stopPropagation();
      await voteOnPoll(row.dataset.pollPost, parseInt(row.dataset.pollOption,10));
      refresh();
    });
  });
  container.querySelectorAll('.post-comment-inline-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const card = btn.closest('.post-card');
      if(card) togglePostComments(card.dataset.postId);
    });
  });
  container.querySelectorAll('.post-comments-panel').forEach(panel=>{
    panel.addEventListener('click', (e)=> e.stopPropagation());
    const input = panel.querySelector('.post-comment-inline-input');
    const sendBtn = panel.querySelector('.post-comment-inline-send');
    const submit = async ()=>{
      const text = input.value.trim();
      if(!text) return;
      const postId = panel.dataset.postId;
      const postUid = panel.dataset.postUid;
      const newCount = parseInt(panel.dataset.commentCount,10) + 1;
      sendBtn.disabled = true;
      try{
        const tagged = extractMentions(text);
        await addDoc(collection(db,'posts',postId,'comments'), { uid:currentUid, name:myProfile.name, text, ...tagged, createdAt:new Date().toISOString() });
        await updateDoc(doc(db,'posts',postId), { commentCount: newCount });
        panel.dataset.commentCount = newCount;
        syncFeedCardCommentCount(postId, newCount);
        notifyFeedActivity({ kind:'comment', postId, postUid, text, ...tagged });
        input.value = '';
        renderPostCommentsPanel(postId);
      }catch(err){ alert(window.BH_I18N.pick("Yorum gönderilemedi: ","Could not send comment: ")+(err.message||err)); }
      finally{ sendBtn.disabled = false; }
    };
    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } });
  });
  container.querySelectorAll('.post-card').forEach(card=>{
    card.addEventListener('click', (e)=>{
      if(e.target.closest('.user-chip') || e.target.closest('.book-cover-clickable') || e.target.closest('[data-poll-option]') || e.target.closest('.post-comment-inline-btn') || e.target.closest('.post-comments-panel') || e.target.closest('.post-vote-btn') || e.target.closest('.reaction-add-btn') || e.target.closest('.post-menu-btn')) return;
      togglePostComments(card.dataset.postId);
    });
  });
}
/*
 * The post window refreshes itself after a comment is added or removed; this also updates the comment
 * count on the post's card in the feed behind it.
 */
function syncFeedCardCommentCount(postId, newCount){
  document.querySelectorAll(`.post-card[data-post-id="${postId}"] .post-comment-count`).forEach(el=>{
    el.textContent = `💬 ${newCount}`;
  });
}
/*
 * Tapping a post expands its card in place (the cards below slide down) instead of opening a dialog;
 * comments are read and written right there.
 */
function togglePostComments(postId){
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if(!card) return;
  const wasExpanded = card.classList.contains('expanded');
  document.querySelectorAll('.post-card.expanded').forEach(c=>{ if(c!==card) c.classList.remove('expanded'); });
  if(wasExpanded){
    card.classList.remove('expanded');
  }else{
    card.classList.add('expanded');
    renderPostCommentsPanel(postId);
  }
}
async function renderPostCommentsPanel(postId){
  const panel = document.querySelector(`.post-comments-panel[data-post-id="${postId}"]`);
  if(!panel) return;
  const list = panel.querySelector('.post-comments-list');
  list.innerHTML = window.BH_I18N.template`<span class="muted">Yükleniyor…</span>`;
  let comments = [];
  const commentsSnap = await getDocs(collection(db,'posts',postId,'comments')).catch(()=>null);
  if(commentsSnap){
    commentsSnap.forEach(d=> comments.push({id:d.id, ...d.data()}));
    comments.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
  }
  list.innerHTML = comments.length ? comments.map(c=>`<div class="rec-comment-row">
    <div class="rec-comment-body">${userChipHtml(c.uid,18)}<span class="muted" style="font-size:11px; margin-left:4px;">· ${timeAgoLabel(c.createdAt)}</span><div style="margin-top:2px;">${highlightMentions(escapeHtml(c.text), c.mentions, c.mentionAll)}</div>${renderReactionBar(c.reactions, `postcomment:${postId}|${c.id}`)}</div>
    ${(c.uid===currentUid||myProfile.role==='admin')?`<button class="rec-comment-del" data-del-postcomment="${c.id}">✕</button>`:''}
  </div>`).join('') : window.BH_I18N.template`<span class="muted">Henüz yorum yok.</span>`;
  list.querySelectorAll('.reaction-pill').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); showReactorsModal(btn.dataset.uids, btn.dataset.emoji); });
  });
  list.querySelectorAll('.reaction-add-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); setPendingReactionRefresh(()=>renderPostCommentsPanel(postId)); toggleReactionDrawer(btn, btn.dataset.target); });
  });
  list.querySelectorAll('[data-del-postcomment]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      if(!confirm(window.BH_I18N.pick("Bu yorumu silmek istediğine emin misin?","Are you sure you want to delete this comment?"))) return;
      try{
        const newCount = Math.max(0, parseInt(panel.dataset.commentCount,10) - 1);
        await deleteDoc(doc(db,'posts',postId,'comments',btn.dataset.delPostcomment));
        await updateDoc(doc(db,'posts',postId), {commentCount: newCount});
        panel.dataset.commentCount = newCount;
        syncFeedCardCommentCount(postId, newCount);
        renderPostCommentsPanel(postId);
      }catch(err){ alert('Silinemedi: '+(err.message||err)); }
    });
  });
}
export async function openPostModal(postId){
  const body = document.getElementById('postModalBody');
  body.innerHTML = window.BH_I18N.template`<span class="muted">Yükleniyor…</span>`;
  document.getElementById('postModal').style.display='flex';
  let p = null, comments = [];
  // Fetch the post and its comments in parallel.
  const [postSnap, commentsSnap] = await Promise.all([
    getDoc(doc(db,'posts',postId)).catch(()=>null),
    getDocs(collection(db,'posts',postId,'comments')).catch(()=>null)
  ]);
  if(postSnap && postSnap.exists()) p = {id:postId, ...postSnap.data()};
  if(!p){ body.innerHTML = window.BH_I18N.template`<span class="muted">Gönderi bulunamadı.</span>`; return; }
  if(commentsSnap){
    commentsSnap.forEach(d=> comments.push({id:d.id, ...d.data()}));
    comments.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
  }
  const commentsHtml = comments.map(c=>`<div class="rec-comment-row">
    <div class="rec-comment-body">${userChipHtml(c.uid,18)}<span class="muted" style="font-size:11px; margin-left:4px;">· ${timeAgoLabel(c.createdAt)}</span><div style="margin-top:2px;">${highlightMentions(escapeHtml(c.text), c.mentions, c.mentionAll)}</div>${renderReactionBar(c.reactions, `postcomment:${postId}|${c.id}`)}</div>
    ${(c.uid===currentUid||myProfile.role==='admin')?`<button class="rec-comment-del" data-del-postcomment="${c.id}">✕</button>`:''}
  </div>`).join('');
  const batchItemsHtml = (p.type==='book_review_batch' || p.type==='book_added_batch') ? `
    <div class="rec-comments-label" style="margin-top:2px;">${window.BH_I18N.pick("📋 Kronolojik Liste","📋 Activity timeline")}</div>
    ${(p.items||[]).slice().sort((a,b)=> new Date(a.at)-new Date(b.at)).map(it=>`<div class="rec-comment-row">
      ${it.bookCover?`<img src="${it.bookCover}" alt="" style="width:32px;height:46px;object-fit:cover;border-radius:4px;" />`:''}
      <div class="rec-comment-body">
        <b>${escapeHtml(it.bookTitle||'')}</b>
        <div class="muted" style="font-size:11px;">${timeAgoLabel(it.at)}</div>
        ${p.type==='book_review_batch' ? `<div style="color:var(--gold); font-size:12.5px; margin-top:2px;">⭐ ${it.rating}/10${it.reviewText?` — "${escapeHtml(it.reviewText)}"`:''}</div>` : window.BH_I18N.template`<div class="muted" style="font-size:12.5px; margin-top:2px;">Kitaplığa eklendi</div>`}
      </div>
    </div>`).join('')}
  ` : '';
  body.innerHTML = window.BH_I18N.template`
    <div class="post-card-head">${userChipHtml(p.uid)}<span class="post-card-time">&middot; ${exactTimeLabel(p.createdAt)}</span></div>
    <div class="post-card-body" style="margin-bottom:10px;">${(()=>{const t=postTitleFor(p); return t?`<div class="post-title" style="font-size:19px;">${t}</div>`:'';})()}${postBodyHtml(p, true)}</div>
    ${batchItemsHtml}
    <div class="post-card-footer">
      ${postVoteRowHtml(p)}
      ${postReactionPillHtml(p)}
      ${(p.uid===currentUid||myProfile.role==='admin')?window.BH_I18N.template`<button type="button" class="secondary tiny" id="postModalDelBtn" style="margin-left:auto;">Kaldır</button>`:''}
    </div>
    <div class="rec-comments-label">💬 ${comments.length} Yorum</div>
    <div id="postModalComments">${commentsHtml}</div>
    <div class="row" style="margin-top:10px;">
      <input type="text" id="postCommentInput" placeholder="Yorum yaz..." data-mentions />
      <button class="secondary tiny" id="postCommentSendBtn" style="flex:0 0 auto;">Gönder</button>
    </div>
  `;
  wireVoteButtons(body);
  body.querySelectorAll('.reaction-pill').forEach(btn=>{
    btn.addEventListener('click', ()=> showReactorsModal(btn.dataset.uids, btn.dataset.emoji));
  });
  body.querySelectorAll('.reaction-add-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); setPendingReactionRefresh(()=>openPostModal(postId)); toggleReactionDrawer(btn, btn.dataset.target); });
  });
  body.querySelectorAll('[data-poll-option]').forEach(row=>{
    row.addEventListener('click', async (e)=>{
      e.stopPropagation();
      await voteOnPoll(row.dataset.pollPost, parseInt(row.dataset.pollOption,10));
      openPostModal(postId);
    });
  });
  body.querySelectorAll('[data-del-postcomment]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm(window.BH_I18N.pick("Bu yorumu silmek istediğine emin misin?","Are you sure you want to delete this comment?"))) return;
      try{
        const newCount = Math.max(0,(p.commentCount||1)-1);
        await deleteDoc(doc(db,'posts',postId,'comments',btn.dataset.delPostcomment));
        await updateDoc(doc(db,'posts',postId), {commentCount: newCount});
        syncFeedCardCommentCount(postId, newCount);
        openPostModal(postId);
      }catch(e){ alert('Silinemedi: '+(e.message||e)); }
    });
  });
  const delPostBtn = document.getElementById('postModalDelBtn');
  if(delPostBtn) delPostBtn.addEventListener('click', async ()=>{
    if(!confirm(window.BH_I18N.pick("Bu gönderiyi silmek istediğine emin misin?","Are you sure you want to delete this post?"))) return;
    try{ await deleteDoc(doc(db,'posts',postId)); closeModal('postModal'); renderTimelineTab(); }catch(err){ alert('Silinemedi: '+(err.message||err)); }
  });
  document.getElementById('postCommentSendBtn').addEventListener('click', async (e)=>{
    const input = document.getElementById('postCommentInput');
    const text = input.value.trim();
    if(!text) return;
    const sendBtn = e.currentTarget;
    sendBtn.disabled = true;
    try{
      const newCount = (p.commentCount||0)+1;
      const tagged = extractMentions(text);
      await addDoc(collection(db,'posts',postId,'comments'), { uid:currentUid, name:myProfile.name, text, ...tagged, createdAt:new Date().toISOString() });
      await updateDoc(doc(db,'posts',postId), { commentCount: newCount });
      syncFeedCardCommentCount(postId, newCount);
      // Notifications don't affect the result, so they aren't awaited.
      notifyFeedActivity({ kind:'comment', postId, postUid: p.uid, text, ...tagged, commenters: comments.map(c=>c.uid) });
      openPostModal(postId);
    }catch(err){ alert(window.BH_I18N.pick("Yorum gönderilemedi: ","Could not send comment: ")+(err.message||err)); sendBtn.disabled = false; }
  });
}

/*
 * Shares the optional reading note written on the Today card after a check-in. It becomes an ordinary
 * member post and is announced like one. Returns whether the post was created.
 */
export async function shareReadingNote(text){
  const tagged = extractMentions(text);
  // Stored in Turkish: posts are shown to every member whatever their language.
  const postId = await createPost('user_post', { title: 'Bugünkü okumamdan', text, image:'', readingNote:true, ...tagged });
  if(!postId) return false;
  notifyFeedActivity({ kind:'post', postId, text, ...tagged });
  if(activeTab==='social') renderTimelineTab();
  return true;
}

export function initFeed(){
  document.getElementById('feedViewSwitch').addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-feed-view]');
    if(!btn || btn.dataset.feedView===timelineView) return;
    setTimelineView(btn.dataset.feedView);
    renderTimelineTab();
  });
  window.addEventListener('resize', positionPinnedPostBar);
  document.getElementById('joinConversationTrigger').addEventListener('click', jcExpand);
  document.getElementById('jcCancelBtn').addEventListener('click', jcCollapse);
  document.getElementById('jcImageBtn').addEventListener('click', ()=> document.getElementById('jcImageInput').click());
  document.getElementById('jcImageInput').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    try{
      jcImageDataUrl = await resizeImageToDataUrl(file, 800, 0.72);
      document.getElementById('jcImagePreview').src = jcImageDataUrl;
      document.getElementById('jcImagePreviewWrap').style.display = 'block';
    }catch(err){ alert(window.BH_I18N.pick("Görsel işlenemedi: ","Could not process image: ")+(err.message||err)); }
  });
  document.getElementById('jcImageRemoveBtn').addEventListener('click', ()=>{
    jcImageDataUrl = null;
    document.getElementById('jcImagePreviewWrap').style.display = 'none';
    document.getElementById('jcImageInput').value = '';
  });
  document.getElementById('jcSendBtn').addEventListener('click', async ()=>{
    const title = document.getElementById('jcTitleInput').value.trim();
    const text = document.getElementById('jcTextInput').value.trim();
    if(!title){ alert(window.BH_I18N.pick("Başlık yazmalısın.","Enter a title.")); return; }
    const btn = document.getElementById('jcSendBtn');
    btn.disabled = true;
    try{
      const tagged = extractMentions(title, text);
      const postId = await createPost('user_post', { title, text, image: jcImageDataUrl||'', ...tagged });
      if(postId) notifyFeedActivity({ kind:'post', postId, text: title, ...tagged });
      jcCollapse();
      showToast(window.BH_I18N.pick("Gönderi paylaşıldı!","Post shared!"));
      renderTimelineTab();
    }catch(err){ alert(window.BH_I18N.pick("Paylaşılamadı: ","Could not share: ")+(err.message||err)); }
    finally{ btn.disabled = false; }
  });
  document.getElementById('composePostBtn').addEventListener('click', ()=>{
    composeImageDataUrl = null;
    let composeMode = 'text';
    showSimpleInfoModal(window.BH_I18N.template`
      <h2 style="margin-bottom:10px;">Yeni Gönderi</h2>
      <div style="display:flex; gap:6px; margin-bottom:12px;">
        <button type="button" class="secondary tiny compose-mode-btn active" data-mode="text" style="flex:1;">📝 Metin</button>
        <button type="button" class="secondary tiny compose-mode-btn" data-mode="poll" style="flex:1;">📊 Anket</button>
      </div>
      <div id="composeTextMode">
        <input type="text" id="composeTitle" class="compose-poll-input" maxlength="100" placeholder="Başlık" style="margin-bottom:8px;" />
        <textarea id="composeText" class="compose-textarea" maxlength="280" placeholder="Ne düşünüyorsun?" data-mentions></textarea>
        <div class="muted" id="composeCharCount" style="text-align:right; font-size:11px; margin-top:2px;"></div>
      </div>
      <div id="composePollMode" style="display:none;">
        <input type="text" id="composePollQuestion" placeholder="Anket sorusu" class="compose-poll-input" />
        <div id="composePollOptions" style="margin-top:8px;"></div>
        <button type="button" class="secondary tiny" id="composePollAddOptionBtn" style="margin-top:4px;">+ Seçenek Ekle</button>
      </div>
      <div id="composeImagePreviewWrap" style="display:none; margin-top:10px; text-align:center;">
        <img id="composeImagePreview" src="" style="max-width:100%; border-radius:10px;" />
        <button type="button" class="secondary tiny" id="composeImageRemoveBtn" style="margin-top:6px;">Görseli Kaldır</button>
      </div>
      <input type="file" id="composeImageInput" accept="image/*" style="display:none;" />
      <button type="button" class="secondary tiny" id="composeImageBtn" style="margin-top:10px;">📷 Görsel Ekle</button>
      <div class="row" style="margin-top:12px;">
        <button type="button" class="primary" id="composeSendBtn" style="flex:1;">Paylaş</button>
      </div>
    `);
    document.querySelectorAll('.compose-mode-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        composeMode = btn.dataset.mode;
        document.querySelectorAll('.compose-mode-btn').forEach(b=> b.classList.toggle('active', b===btn));
        document.getElementById('composeTextMode').style.display = composeMode==='text' ? 'block' : 'none';
        document.getElementById('composePollMode').style.display = composeMode==='poll' ? 'block' : 'none';
      });
    });
    function addPollOptionRow(placeholder){
      const container = document.getElementById('composePollOptions');
      const row = document.createElement('div');
      row.className = 'compose-poll-option-row';
      row.innerHTML = window.BH_I18N.template`<input type="text" class="compose-poll-input compose-poll-option" placeholder="${placeholder}" />
        <button type="button" class="compose-poll-option-remove" title="Kaldır">✕</button>`;
      container.appendChild(row);
      row.querySelector('.compose-poll-option-remove').addEventListener('click', ()=>{
        if(container.querySelectorAll('.compose-poll-option-row').length<=2){ showToast(window.BH_I18N.pick("En az 2 seçenek olmalı.","At least 2 options are required.")); return; }
        row.remove();
      });
    }
    addPollOptionRow(window.BH_I18N.pick("Seçenek 1","Option 1"));
    addPollOptionRow(window.BH_I18N.pick("Seçenek 2","Option 2"));
    document.getElementById('composePollAddOptionBtn').addEventListener('click', ()=>{
      const count = document.querySelectorAll('.compose-poll-option-row').length;
      if(count>=8){ showToast(window.BH_I18N.pick("En fazla 8 seçenek eklenebilir.","You can add up to 8 options.")); return; }
      addPollOptionRow(window.BH_I18N.template`Seçenek ${count+1}`);
    });
    const textarea = document.getElementById('composeText');
    const counter = document.getElementById('composeCharCount');
    function updateLimit(){
      const max = composeImageDataUrl ? 140 : 280;
      textarea.maxLength = max;
      if(textarea.value.length > max) textarea.value = textarea.value.slice(0, max);
      counter.textContent = `${max - textarea.value.length} karakter kaldı`;
    }
    textarea.addEventListener('input', updateLimit);
    updateLimit();
    document.getElementById('composeImageBtn').addEventListener('click', ()=> document.getElementById('composeImageInput').click());
    document.getElementById('composeImageInput').addEventListener('change', async (e)=>{
      const file = e.target.files[0];
      if(!file) return;
      try{
        composeImageDataUrl = await resizeImageToDataUrl(file, 800, 0.72);
        document.getElementById('composeImagePreview').src = composeImageDataUrl;
        document.getElementById('composeImagePreviewWrap').style.display='block';
        updateLimit();
      }catch(err){ alert(window.BH_I18N.pick("Görsel işlenemedi: ","Could not process image: ")+(err.message||err)); }
    });
    document.getElementById('composeImageRemoveBtn').addEventListener('click', ()=>{
      composeImageDataUrl = null;
      document.getElementById('composeImagePreviewWrap').style.display='none';
      document.getElementById('composeImageInput').value = '';
      updateLimit();
    });
    document.getElementById('composeSendBtn').addEventListener('click', async ()=>{
      if(composeMode==='poll'){
        const question = document.getElementById('composePollQuestion').value.trim();
        const options = [...document.querySelectorAll('.compose-poll-option')].map(inp=>inp.value.trim()).filter(Boolean);
        if(!question){ alert(window.BH_I18N.pick("Anket sorusu yazmalısın.","Enter a poll question.")); return; }
        if(options.length<2){ alert(window.BH_I18N.pick("En az 2 seçenek yazmalısın.","Enter at least 2 options.")); return; }
        try{
          const tagged = extractMentions(question);
          const postId = await createPost('poll', { question, options: options.map(text=>({text, voters:[]})), image: composeImageDataUrl||'', ...tagged });
          if(postId) notifyFeedActivity({ kind:'post', postId, text: question, ...tagged, everyoneMessage: `${myProfile.name} bir anket paylaştı: "${snippet(question)}"` });
          closeModal('bookInfoModal');
          showToast(window.BH_I18N.pick("Anket paylaşıldı!","Poll shared!"));
          renderTimelineTab();
        }catch(err){ alert(window.BH_I18N.pick("Paylaşılamadı: ","Could not share: ")+(err.message||err)); }
        return;
      }
      const title = document.getElementById('composeTitle').value.trim();
      const text = textarea.value.trim();
      if(!title){ alert(window.BH_I18N.pick("Başlık yazmalısın.","Enter a title.")); return; }
      if(!text && !composeImageDataUrl){ alert(window.BH_I18N.pick("Bir şey yazmalısın veya görsel eklemelisin.","Write something or add an image.")); return; }
      try{
        const tagged = extractMentions(title, text);
        const postId = await createPost('user_post', { title, text, image: composeImageDataUrl||'', ...tagged });
        if(postId) notifyFeedActivity({ kind:'post', postId, text: title, ...tagged });
        closeModal('bookInfoModal');
        showToast(window.BH_I18N.pick("Gönderi paylaşıldı!","Post shared!"));
        renderTimelineTab();
      }catch(err){ alert(window.BH_I18N.pick("Paylaşılamadı: ","Could not share: ")+(err.message||err)); }
    });
  });
  document.getElementById('postModalClose').addEventListener('click', ()=> closeModal('postModal'));
  document.getElementById('postModal').addEventListener('click', (e)=>{ if(e.target.id==='postModal') closeModal('postModal'); });
}

