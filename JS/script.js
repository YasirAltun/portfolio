// Arka plan animasyonu için kod
const canvas = document.getElementById("background");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const nodes = [];
const mouse = { x: null, y: null };

// Node (Düğüm) Sınıfı
class Node {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = Math.random() * 2 - 1; // Rastgele hız (x ekseni)
        this.vy = Math.random() * 2 - 1; // Rastgele hız (y ekseni)
        this.radius = 3; // Node boyutu
        this.color = "#cd1212"; // Kırmızı renk
    }

    // Node'u çiz
    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
    }

    // Node'u hareket ettir
    update() {
        // Kenarlardan sekme
        if (this.x + this.radius > canvas.width || this.x - this.radius < 0) {
            this.vx = -this.vx;
        }
        if (this.y + this.radius > canvas.height || this.y - this.radius < 0) {
            this.vy = -this.vy;
        }

        // Fareye doğru hafifçe hareket et
        if (mouse.x !== null && mouse.y !== null) {
            const dx = mouse.x - this.x;
            const dy = mouse.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 80) { // Fareye yakınsa hafifçe çek
                this.x += dx * 0.02; // 0.01 yerine 0.03 yaparak hızı artır
                this.y += dy * 0.02; // 0.01 yerine 0.03 yaparak hızı artır
            }
        }

        // Node'u hareket ettir
        this.x += this.vx;
        this.y += this.vy;

        // Node'u çiz
        this.draw();
    }
}

// Bağlantıları çiz
function drawConnections() {
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Bağlantı mesafesi (0 ile 100 arasında)
            if (distance < 100) {
                // Mesafe 0 ise alpha = 1, mesafe 100 ise alpha = 0
                const alpha = 1 - (distance / 100); // Mesafe arttıkça opaklık azalır
                ctx.beginPath();
                ctx.moveTo(nodes[i].x, nodes[i].y);
                ctx.lineTo(nodes[j].x, nodes[j].y);
                ctx.strokeStyle = `rgba(205, 18, 18, ${alpha})`; // Kırmızı renk ve opaklık
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.closePath();
            }
        }
    }
}

// Animasyonu başlat
function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Tüm nodeları güncelle ve çiz
    nodes.forEach(node => node.update());

    // Bağlantıları çiz
    drawConnections();

    requestAnimationFrame(animate);
}

// Fare hareketini takip et
window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

// Fare sayfadan çıkınca sıfırla
window.addEventListener("mouseout", () => {
    mouse.x = null;
    mouse.y = null;
});

// Pencere boyutu değiştiğinde canvas'ı yeniden boyutlandır
window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// Node'ları oluştur
const numberOfNodes = 400; // Node sayısını buradan ayarla
for (let i = 0; i < numberOfNodes; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    nodes.push(new Node(x, y));
}

// Animasyonu başlat
animate();

// Referanslar bölümü için kod
async function fetchReferences() {
    const response = await fetch("JS/references.json");
    const references = await response.json();
    return references;
}

// Referans kartlarını oluşturma
function createReferenceCard(reference) {
    const card = document.createElement("div");
    card.classList.add("reference-card");

    card.innerHTML = `
        <h3>${reference.name}</h3>
        <p class="position">${reference.position}</p>
        <p class="relationship">${reference.relationship}</p>
        <button class="contact-btn" 
                data-name="${reference.name}" 
                data-position="${reference.position}" 
                data-email="${reference.email}" 
                data-phone="${reference.phone}" 
                data-image="${reference.image}">
            Show Contact Info
        </button>
    `;

    return card;
}

// Modalı açma
function openModal(name, position, email, phone, image) {
    const modalName = document.getElementById("modal-name");
    const modalPosition = document.getElementById("modal-position");
    const modalEmail = document.getElementById("modal-email");
    const modalPhone = document.getElementById("modal-phone");
    const modalImage = document.getElementById("modal-image");

    modalName.textContent = name;
    modalPosition.textContent = position;
    modalEmail.textContent = `Email: ${email}`;
    modalPhone.textContent = `Phone: ${phone}`;
    modalImage.src = image;

    const modalOverlay = document.querySelector(".modal-overlay");
    modalOverlay.classList.add("active");
}

// Modalı kapatma
function closeModal() {
    const modalOverlay = document.querySelector(".modal-overlay");
    modalOverlay.classList.remove("active");
}

// Sayfa yüklendiğinde referansları çek ve kartları oluştur
document.addEventListener("DOMContentLoaded", async () => {
    const references = await fetchReferences();
    const referenceGrid = document.getElementById("reference-grid");

    references.forEach(reference => {
        const card = createReferenceCard(reference);
        referenceGrid.appendChild(card);
    });

    // Butonlara tıklama olayı ekle
    const contactButtons = document.querySelectorAll(".contact-btn");
    contactButtons.forEach(button => {
        button.addEventListener("click", () => {
            const name = button.getAttribute("data-name");
            const position = button.getAttribute("data-position");
            const email = button.getAttribute("data-email");
            const phone = button.getAttribute("data-phone");
            const image = button.getAttribute("data-image");

            openModal(name, position, email, phone, image);
        });
    });

    // Modalı kapatma butonu
    const closeBtn = document.querySelector(".close-btn");
    closeBtn.addEventListener("click", closeModal);

    // Modal dışına tıklandığında kapat
    const modalOverlay = document.querySelector(".modal-overlay");
    modalOverlay.addEventListener("click", (e) => {
        if (e.target === modalOverlay) {
            closeModal();
        }
    });
});


// Form gönderimini işle
document.querySelector(".contact-form").addEventListener("submit", function (e) {
    e.preventDefault(); // Formun varsayılan davranışını engelle

    // Form verilerini al
    const name = document.getElementById("name").value;
    const email = document.getElementById("email").value;
    const message = document.getElementById("message").value;

    // Form verilerini konsola yazdır (şimdilik)
    console.log("Name:", name);
    console.log("Email:", email);
    console.log("Message:", message);

    // Formu temizle
    document.getElementById("name").value = "";
    document.getElementById("email").value = "";
    document.getElementById("message").value = "";

    // Kullanıcıya geri bildirim göster (örneğin, bir toast mesajı)
    alert("Message sent successfully!");
});



