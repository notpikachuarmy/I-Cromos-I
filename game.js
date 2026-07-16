/* =========================================================
   TOTOTO CLICKER 2.0 - GAME.JS
   Núcleo del juego: carga CSV, estado global, navegación,
   click principal, bucle pasivo e inicialización.
   ========================================================= */

/* =========================
   CONFIGURACIÓN CSV
   ========================= */

const LINK_CSV_CROMOS = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQVmg-Qn17A0Ms4NLdYAbQHcwkVrvwPD7ORJxKlMDNcY6JGTfQ7p_i4LCiy0-B74Wcs_9Jwc1nZ1KfO/pub?output=csv";
const LINK_CSV_ALBUMES = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRwFTVpC8PBxaPzki-PImk153OhSllxX3_iot9FdLpnVzYWJpxq8DbU5NHTkiXsZN2peQI9XkbD9gh1/pub?output=csv";

const APP_VERSION = "2.2.0";
const CSV_CACHE_KEYS = {
    cards: "tototo_csv_cards_v1",
    albums: "tototo_csv_albums_v1"
};
const LOCAL_CSV_FALLBACKS = {
    cards: "data/cromos.csv",
    albums: "data/albumes.csv"
};
const DATA_FETCH_TIMEOUT_MS = 8000;
const MAX_OFFLINE_SECONDS = 8 * 60 * 60;
const LAST_TAB_KEY = "tototo_last_tab";

let DATA_SOURCE = "online";
let deferredInstallPrompt = null;
let lastFocusedElement = null;
let GAME_READY = false;
let saveTimer = null;

/* =========================
   BASE DE DATOS EN MEMORIA
   ========================= */

let BASE_DE_CROMOS = [];
let CONFIG_ALBUMES = [];
let SOBRES_TIENDA = {};

let CURRENT_ALBUM_ID = null;
let CURRENT_ACHIEVEMENT_FILTER = "todos";

const RAREZAS = ["N", "R", "SR", "SSR", "UR"];

const DEFAULT_RARITY_STATS = {
    N: 0,
    R: 0,
    SR: 0,
    SSR: 0,
    UR: 0
};

/* =========================
   ESTADO DEL JUEGO
   ========================= */

function crearEstadoBase() {
    return {
        version: 2,

        coins: 0,
        totalPassive: 0,

        clickValue: 1,
        baseClickValue: 1,

        inventario: [],
        fragmentos: {},

        albumPrestige: {},
        albumPassiveClaims: {},
        collectionBonuses: {},

        favorites: [],
        showcase: [],
        packHistory: [],
        bestOpening: null,

        upgrades: {},

        achievements: {
            claimed: {}
        },

        missions: {
            current: null,
            completed: 0
        },

        encyclopedia: {},

        stats: {
            clicks: 0,
            coinsEarned: 0,
            coinsSpent: 0,

            totalPacksOpened: 0,
            packsByAlbum: {},

            raritiesObtained: { ...DEFAULT_RARITY_STATS },

            duplicates: 0,
            fragmentsEarned: 0,
            fragmentsSpent: 0,

            newCardsObtained: 0,
            completedAlbums: 0,
            maxAlbumPrestige: 0,
            totalAlbumPrestiges: 0,

            achievementsUnlocked: 0,
            missionsCompleted: 0,

            startedAt: Date.now(),
            lastPlayedAt: Date.now(),
            playTimeSeconds: 0
        },

        settings: {
            soundEnabled: true,
            theme: "auto",
            smartOpening: {
                stopOnUR: false,
                stopOnAlbumComplete: false,
                compactSummary: false
            }
        }
    };
}

let gameState = crearEstadoBase();

/* =========================
   INICIO
   ========================= */

document.addEventListener("DOMContentLoaded", () => {
    iniciarJuego();
});

document.addEventListener("visibilitychange", () => {
    if (GAME_READY && document.visibilityState === "hidden") guardar();
});

window.addEventListener("beforeunload", () => {
    if (GAME_READY) guardar();
});

async function iniciarJuego() {
    try {
        actualizarPantallaCarga("Cargando tu partida...");
        prepararNavegacion();
        prepararModales();
        prepararBotonesSistema();
        prepararAjustesRapidos();
        prepararInstalacionPWA();
        registrarServiceWorker();

        if (window.SaveSystem?.load) {
            gameState = window.SaveSystem.load(crearEstadoBase());
        } else {
            const raw = localStorage.getItem("tototo_save_v2");
            gameState = raw ? JSON.parse(raw) : crearEstadoBase();
        }

        normalizarEstado();
        aplicarTemaGuardado();
        renderHeader();

        actualizarPantallaCarga("Cargando cromos y álbumes...");
        await cargarDatosCSV();

        normalizarEstado();
        window.CollectionHub?.ensureState?.();
        window.CollectionHub?.checkAllBonuses?.({ notify: false });
        recalcularDerivados();
        const offlineReward = aplicarProgresoOffline();

        if (window.Achievements?.buildAlbumAchievements) {
            window.Achievements.buildAlbumAchievements(CONFIG_ALBUMES);
        }

        if (window.Missions?.ensureMission) {
            window.Missions.ensureMission();
        }

        renderTodo();
        restaurarUltimaPestana();
        GAME_READY = true;
        iniciarLoops();
        actualizarEstadoAplicacion();
        ocultarPantallaCarga();

        if (offlineReward > 0) {
            toast(`Mientras no estabas ganaste ${formatNumber(offlineReward)} monedas.`, "success", 4500);
        } else {
            toast(`Tototo Clicker ${APP_VERSION} cargado.`, "success");
        }
    } catch (error) {
        console.error(error);
        mostrarErrorCarga(error);
    }
}

/* =========================
   CARGA CSV
   ========================= */

async function cargarDatosCSV() {
    const cachedCards = leerCacheCSV(CSV_CACHE_KEYS.cards);
    const cachedAlbums = leerCacheCSV(CSV_CACHE_KEYS.albums);

    if (cachedCards && cachedAlbums) {
        try {
            validarCSV(cachedCards, "cromos en caché");
            validarCSV(cachedAlbums, "álbumes en caché");
            parsearCromos(cachedCards);
            parsearAlbumes(cachedAlbums);

            if (!BASE_DE_CROMOS.length || !CONFIG_ALBUMES.length) {
                throw new Error("La caché de datos está vacía.");
            }

            DATA_SOURCE = navigator.onLine === false ? "offline" : "cache";

            // Actualiza silenciosamente los datos para la siguiente sesión.
            Promise.allSettled([
                descargarYCachearCSV(LINK_CSV_CROMOS, CSV_CACHE_KEYS.cards),
                descargarYCachearCSV(LINK_CSV_ALBUMES, CSV_CACHE_KEYS.albums)
            ]).then(results => {
                if (results.every(result => result.status === "fulfilled")) {
                    DATA_SOURCE = "online";
                }
                actualizarEstadoAplicacion();
            });
            return;
        } catch (error) {
            eliminarCacheCSV();
            BASE_DE_CROMOS = [];
            CONFIG_ALBUMES = [];
            SOBRES_TIENDA = {};
        }
    }

    const [cardsResult, albumsResult] = await Promise.all([
        cargarFuenteCSV({
            remoteUrl: LINK_CSV_CROMOS,
            localUrl: LOCAL_CSV_FALLBACKS.cards,
            cacheKey: CSV_CACHE_KEYS.cards,
            label: "cromos"
        }),
        cargarFuenteCSV({
            remoteUrl: LINK_CSV_ALBUMES,
            localUrl: LOCAL_CSV_FALLBACKS.albums,
            cacheKey: CSV_CACHE_KEYS.albums,
            label: "álbumes"
        })
    ]);

    parsearCromos(cardsResult.text);
    parsearAlbumes(albumsResult.text);

    DATA_SOURCE = cardsResult.source === "online" && albumsResult.source === "online"
        ? "online"
        : "cache";
}

async function cargarFuenteCSV({ remoteUrl, localUrl, cacheKey, label }) {
    try {
        const text = await descargarYCachearCSV(remoteUrl, cacheKey);
        return { text, source: "online" };
    } catch (remoteError) {
        try {
            const localText = await fetchTextWithTimeout(localUrl, 2500);
            validarCSV(localText, label);
            guardarCacheCSV(cacheKey, localText);
            return { text: localText, source: "local" };
        } catch (localError) {
            const cached = leerCacheCSV(cacheKey);
            if (cached) return { text: cached, source: "cache" };

            throw new Error(
                `No se pudieron cargar los datos de ${label}. ` +
                "Comprueba tu conexión o añade el CSV local indicado en el README."
            );
        }
    }
}

async function descargarYCachearCSV(url, cacheKey) {
    const text = await fetchTextWithTimeout(url, DATA_FETCH_TIMEOUT_MS);
    validarCSV(text, cacheKey);
    guardarCacheCSV(cacheKey, text);
    return text;
}

async function fetchTextWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            cache: "no-cache"
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.text();
    } finally {
        clearTimeout(timeoutId);
    }
}

function validarCSV(text, label) {
    if (typeof text !== "string" || text.trim().split(/\r?\n/).length < 2) {
        throw new Error(`CSV inválido: ${label}`);
    }
}

function guardarCacheCSV(key, text) {
    try {
        localStorage.setItem(key, text);
    } catch (error) {
        console.warn("No se pudo guardar la caché CSV:", error);
    }
}

function leerCacheCSV(key) {
    try {
        return localStorage.getItem(key) || "";
    } catch (error) {
        return "";
    }
}

function eliminarCacheCSV() {
    try {
        localStorage.removeItem(CSV_CACHE_KEYS.cards);
        localStorage.removeItem(CSV_CACHE_KEYS.albums);
    } catch (error) {
        // El almacenamiento puede estar desactivado; se continuará sin caché.
    }
}

function parseCSVLine(line) {
    const result = [];
    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"' && insideQuotes && next === '"') {
            current += '"';
            i++;
        } else if (char === '"') {
            insideQuotes = !insideQuotes;
        } else if (char === "," && !insideQuotes) {
            result.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

function parsearCromos(csv) {
    BASE_DE_CROMOS = [];

    const filas = csv
        .split(/\r?\n/)
        .filter(fila => fila.trim() !== "")
        .slice(1);

    BASE_DE_CROMOS = filas.map(fila => {
        const columnas = parseCSVLine(fila);
        const [id, nombre, rareza, tags] = columnas;

        const rarezaNormalizada = String(rareza || "N").trim().toUpperCase();

        return {
            id: String(id || "").trim(),
            nombre: String(nombre || "Cromo sin nombre").trim(),
            rareza: RAREZAS.includes(rarezaNormalizada) ? rarezaNormalizada : "N",
            tags: tags
                ? String(tags).split(";").map(tag => tag.toUpperCase().trim()).filter(Boolean)
                : [],
            imagen: `Cromos/${String(id || "").trim()}.webp`
        };
    }).filter(cromo => cromo.id);
}

function parsearAlbumes(csv) {
    CONFIG_ALBUMES = [];
    SOBRES_TIENDA = {};

    const filas = csv
        .split(/\r?\n/)
        .filter(fila => fila.trim() !== "")
        .slice(1);

    filas.forEach(fila => {
        const columnas = parseCSVLine(fila);
        const [id, nombre, tags, inicio, fin, costo] = columnas;

        const albumId = String(id || "").trim();
        if (!albumId) return;

        const tagsArr = tags
            ? String(tags).split(";").map(tag => tag.toUpperCase().trim()).filter(Boolean)
            : [];

        const album = {
            id: albumId,
            nombre: String(nombre || albumId).trim(),
            tags: tagsArr,
            portada: `Portadas/${albumId}.webp`,
            inicio: inicio || "",
            fin: fin || "",
            costo: parseInt(costo, 10) || 100
        };

        CONFIG_ALBUMES.push(album);

        SOBRES_TIENDA[albumId] = {
            id: albumId,
            nombre: album.nombre,
            costo: album.costo,
            portada: album.portada,
            tags: tagsArr
        };
    });
}

/* =========================
   NORMALIZACIÓN DEL ESTADO
   ========================= */

function normalizarEstado() {
    const base = crearEstadoBase();

    gameState = {
        ...base,
        ...gameState,
        stats: {
            ...base.stats,
            ...(gameState.stats || {}),
            raritiesObtained: {
                ...DEFAULT_RARITY_STATS,
                ...((gameState.stats && gameState.stats.raritiesObtained) || {})
            },
            packsByAlbum: {
                ...((gameState.stats && gameState.stats.packsByAlbum) || {})
            }
        },
        achievements: {
            ...base.achievements,
            ...(gameState.achievements || {}),
            claimed: {
                ...((gameState.achievements && gameState.achievements.claimed) || {})
            }
        },
        missions: {
            ...base.missions,
            ...(gameState.missions || {})
        },
        settings: {
            ...base.settings,
            ...(gameState.settings || {}),
            smartOpening: {
                ...base.settings.smartOpening,
                ...((gameState.settings && gameState.settings.smartOpening) || {})
            }
        },
        upgrades: {
            ...(gameState.upgrades || {})
        },
        encyclopedia: {
            ...(gameState.encyclopedia || {})
        },
        albumPrestige: {
            ...(gameState.albumPrestige || {})
        },
        albumPassiveClaims: {
            ...(gameState.albumPassiveClaims || {})
        },
        collectionBonuses: {
            ...(gameState.collectionBonuses || {})
        },
        fragmentos: {
            ...(gameState.fragmentos || {})
        },
        inventario: Array.isArray(gameState.inventario) ? gameState.inventario : [],
        favorites: Array.isArray(gameState.favorites) ? gameState.favorites : [],
        showcase: Array.isArray(gameState.showcase) ? gameState.showcase : [],
        packHistory: Array.isArray(gameState.packHistory) ? gameState.packHistory.slice(0, 20) : [],
        bestOpening: gameState.bestOpening && typeof gameState.bestOpening === "object" ? gameState.bestOpening : null
    };

    CONFIG_ALBUMES.forEach(album => {
        if (!Number.isFinite(gameState.albumPrestige[album.id])) {
            gameState.albumPrestige[album.id] = 0;
        }

        if (!Number.isFinite(gameState.albumPassiveClaims[album.id])) {
            gameState.albumPassiveClaims[album.id] = 0;
        }

        if (!Number.isFinite(gameState.stats.packsByAlbum[album.id])) {
            gameState.stats.packsByAlbum[album.id] = 0;
        }
    });

    RAREZAS.forEach(rareza => {
        if (!Number.isFinite(gameState.stats.raritiesObtained[rareza])) {
            gameState.stats.raritiesObtained[rareza] = 0;
        }
    });

    gameState.coins = Number(gameState.coins) || 0;
    gameState.clickValue = Number(gameState.clickValue) || 1;
    gameState.baseClickValue = Number(gameState.baseClickValue) || 1;
}

/* =========================
   CÁLCULOS GENERALES
   ========================= */

function recalcularDerivados() {
    gameState.clickValue = calcularClickValue();
    gameState.totalPassive = calcularProduccionPasivaTotal();

    gameState.stats.completedAlbums = contarAlbumesCompletos();
    gameState.stats.maxAlbumPrestige = calcularMaximoPrestigioAlbum();
    gameState.stats.achievementsUnlocked = Object.values(gameState.achievements.claimed || {}).filter(Boolean).length;
    gameState.stats.missionsCompleted = gameState.missions.completed || 0;
}

function calcularClickValue() {
    let value = gameState.baseClickValue || 1;

    if (window.Upgrades?.getClickBonusMultiplier) {
        value *= window.Upgrades.getClickBonusMultiplier();
    }

    if (window.CollectionHub?.getClickMultiplier) {
        value *= window.CollectionHub.getClickMultiplier();
    }

    return Math.max(1, Math.floor(value));
}

function calcularProduccionPasivaTotal() {
    let total = 0;

    if (window.Upgrades?.getPassiveFlatBonus) {
        total += window.Upgrades.getPassiveFlatBonus();
    }

    CONFIG_ALBUMES.forEach(album => {
        const cromosAlbum = getCromosDeAlbum(album.id);
        const claims = gameState.albumPassiveClaims[album.id] || 0;
        total += cromosAlbum.length * 10 * claims;
    });

    if (window.Upgrades?.getPassiveBonusMultiplier) {
        total *= window.Upgrades.getPassiveBonusMultiplier();
    }

    if (window.CollectionHub?.getPassiveMultiplier) {
        total *= window.CollectionHub.getPassiveMultiplier();
    }

    return Math.floor(total);
}

function contarAlbumesCompletos() {
    return CONFIG_ALBUMES.filter(album => albumEstaCompleto(album.id)).length;
}

function calcularMaximoPrestigioAlbum() {
    const valores = Object.values(gameState.albumPrestige || {});
    return valores.length ? Math.max(...valores.map(v => Number(v) || 0)) : 0;
}

function getCromosDeAlbum(albumId) {
    const album = CONFIG_ALBUMES.find(a => a.id === albumId);
    if (!album) return [];

    return BASE_DE_CROMOS.filter(cromo =>
        cromo.tags.some(tag => album.tags.includes(tag))
    );
}

function albumEstaCompleto(albumId) {
    const cromos = getCromosDeAlbum(albumId);
    if (!cromos.length) return false;

    return cromos.every(cromo => gameState.inventario.includes(cromo.id));
}

function getAlbumPrincipalDeCromo(cromo) {
    if (!cromo) return null;

    return CONFIG_ALBUMES.find(album =>
        cromo.tags.some(tag => album.tags.includes(tag))
    ) || null;
}

function getTagBaseDeAlbum(albumId) {
    const album = CONFIG_ALBUMES.find(a => a.id === albumId);
    return album?.tags?.[0] || "GENERAL";
}

/* =========================
   NAVEGACIÓN POR PESTAÑAS
   ========================= */

function prepararNavegacion() {
    const tabButtons = [...document.querySelectorAll("[data-tab]")];

    tabButtons.forEach((button, index) => {
        button.addEventListener("click", () => {
            cambiarTab(button.dataset.tab);
        });

        button.addEventListener("keydown", event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();

            let nextIndex = index;
            if (event.key === "ArrowRight") nextIndex = (index + 1) % tabButtons.length;
            if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = tabButtons.length - 1;

            tabButtons[nextIndex].focus();
            cambiarTab(tabButtons[nextIndex].dataset.tab);
        });
    });

    document.querySelectorAll("[data-tab-target]").forEach(button => {
        button.addEventListener("click", () => {
            cambiarTab(button.dataset.tabTarget);
        });
    });
}

function cambiarTab(tabId, { persist = true } = {}) {
    const targetSection = document.getElementById(`tab-${tabId}`);
    if (!targetSection) return;

    document.querySelectorAll(".tab-button").forEach(button => {
        const isActive = button.dataset.tab === tabId;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
        button.tabIndex = isActive ? 0 : -1;
    });

    document.querySelectorAll(".tab-section").forEach(section => {
        const isActive = section.id === `tab-${tabId}`;
        section.classList.toggle("active", isActive);
        section.hidden = !isActive;
    });

    if (persist) {
        localStorage.setItem(LAST_TAB_KEY, tabId);
    }

    if (tabId === "estadisticas" && window.Statistics?.render) {
        window.Statistics.render();
    }

    if (tabId === "logros" && window.Achievements?.render) {
        window.Achievements.render(CURRENT_ACHIEVEMENT_FILTER);
    }

    if (tabId === "misiones" && window.Missions?.render) {
        window.Missions.render();
    }

    if (tabId === "laboratorio" && window.Upgrades?.render) {
        window.Upgrades.render();
    }
}

/* =========================
   CLICKS Y PASIVA
   ========================= */

function prepararClickPrincipal() {
    const button = document.getElementById("main-click-button");
    if (!button) return;

    button.addEventListener("click", event => {
        const gain = gameState.clickValue;
        ganarMonedas(gain, { render: false });

        gameState.stats.clicks += 1;

        if (window.Missions?.onProgress) {
            window.Missions.onProgress("clicks", 1);
        }

        if (window.Sounds?.play) {
            window.Sounds.play("click");
        }

        crearNumeroFlotante(event, `+${gain}`);

        renderTodoLigero();
        programarGuardado();

        if (gameState.stats.clicks % 25 === 0) {
            window.Achievements?.checkAll?.();
        }
    });
}

function ganarMonedas(cantidad, { render = true } = {}) {
    const value = Math.max(0, Number(cantidad) || 0);

    gameState.coins += value;
    gameState.stats.coinsEarned += value;

    if (render) actualizarInterfazEconomia();
}

function gastarMonedas(cantidad, { render = true } = {}) {
    const value = Math.max(0, Number(cantidad) || 0);

    if (gameState.coins < value) {
        return false;
    }

    gameState.coins -= value;
    gameState.stats.coinsSpent += value;

    if (window.Missions?.onProgress) {
        window.Missions.onProgress("spendCoins", value);
    }

    if (render) actualizarInterfazEconomia();

    return true;
}

function actualizarInterfazEconomia() {
    recalcularDerivados();
    renderHeader();
    renderHome();

    const activeTab = document.querySelector(".tab-button.active")?.dataset.tab;

    if (activeTab === "tienda" && window.Shop?.render) {
        window.Shop.render();
    }

    if (activeTab === "laboratorio" && window.Upgrades?.render) {
        window.Upgrades.render();
    } else if (window.Upgrades?.renderSummary) {
        window.Upgrades.renderSummary();
    }

    if (window.Missions?.renderPreview) {
        window.Missions.renderPreview();
    }

    if (window.Statistics?.renderIfVisible) {
        window.Statistics.renderIfVisible();
    }
}

function iniciarLoops() {
    prepararClickPrincipal();

    setInterval(() => {
        gameState.stats.playTimeSeconds += 1;
        gameState.stats.lastPlayedAt = Date.now();

        recalcularDerivados();

        if (gameState.totalPassive > 0) {
            ganarMonedas(gameState.totalPassive, { render: false });
        }

        renderTodoLigero();

        if (gameState.stats.playTimeSeconds % 10 === 0) {
            guardar();
        }
    }, 1000);
}

function crearNumeroFlotante(event, texto) {
    const container = document.getElementById("floating-click-container");
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const span = document.createElement("span");
    span.className = "floating-number";
    span.textContent = texto;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    span.style.left = `${x}px`;
    span.style.top = `${y}px`;

    container.appendChild(span);

    setTimeout(() => span.remove(), 850);
}

/* =========================
   RENDER GLOBAL
   ========================= */

function renderTodo() {
    recalcularDerivados();

    renderHeader();
    renderHome();

    if (window.Shop?.render) window.Shop.render();
    if (window.Albums?.render) window.Albums.render();
    if (window.Upgrades?.render) window.Upgrades.render();
    if (window.Achievements?.render) window.Achievements.render(CURRENT_ACHIEVEMENT_FILTER);
    if (window.Missions?.render) window.Missions.render();
    if (window.Statistics?.render) window.Statistics.render();
    if (window.CollectionHub?.render) window.CollectionHub.render();

    renderMochila();

    if (window.Achievements?.checkAll) {
        window.Achievements.checkAll();
    }
}

function renderTodoLigero() {
    recalcularDerivados();

    renderHeader();
    renderHome();

    if (window.Missions?.renderPreview) window.Missions.renderPreview();
    if (window.Statistics?.renderIfVisible) window.Statistics.renderIfVisible();
    if (window.Upgrades?.renderSummary) window.Upgrades.renderSummary();
}

function renderHeader() {
    setText("coin-count", formatNumber(Math.floor(gameState.coins)));
    setText("cps-count", formatNumber(gameState.totalPassive));
    setText("total-prestige-count", formatNumber(gameState.stats.totalAlbumPrestiges || 0));
}

function renderHome() {
    setText("click-value-label", formatNumber(gameState.clickValue));

    const totalCromos = BASE_DE_CROMOS.length;
    const unicos = gameState.inventario.length;

    setText("home-unique-cards", `${formatNumber(unicos)} / ${formatNumber(totalCromos)}`);
    setText("home-completed-albums", formatNumber(gameState.stats.completedAlbums || 0));
    setText("home-achievements", formatNumber(gameState.stats.achievementsUnlocked || 0));
}

function renderMochila() {
    const container = document.getElementById("fragment-inventory");
    if (!container) return;

    const tags = Object.keys(gameState.fragmentos || {})
        .filter(tag => (gameState.fragmentos[tag] || 0) > 0)
        .sort();

    if (!tags.length) {
        container.innerHTML = `<div class="empty-state">Mochila vacía.</div>`;
        return;
    }

    container.innerHTML = tags.map(tag => {
        const cantidad = gameState.fragmentos[tag] || 0;
        const progreso = Math.min(100, (cantidad / 50) * 100);

        return `
            <article class="fragment-card">
                <strong>${escapeHTML(tag)}</strong>
                <p>${formatNumber(cantidad)} / 50 fragmentos</p>
                <div class="frag-bar-bg">
                    <div class="frag-bar-fill" style="width:${progreso}%"></div>
                </div>
            </article>
        `;
    }).join("");
}

/* =========================
   MODALES
   ========================= */

function prepararModales() {
    document.querySelectorAll("[data-close-modal]").forEach(button => {
        button.addEventListener("click", cerrarModales);
    });

    document.querySelectorAll(".modal").forEach(modal => {
        modal.addEventListener("click", event => {
            if (event.target === modal) cerrarModales();
        });
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") cerrarModales();
        atraparFocoModal(event);
    });
}

function abrirModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    lastFocusedElement = document.activeElement;
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    const dialog = modal.querySelector('[role="dialog"]');
    if (dialog) dialog.tabIndex = -1;
    requestAnimationFrame(() => modal.querySelector("[data-close-modal]")?.focus());
}

function cerrarModales() {
    const hadOpenModal = Boolean(document.querySelector(".modal.show"));

    document.querySelectorAll(".modal").forEach(modal => {
        modal.classList.remove("show");
        modal.setAttribute("aria-hidden", "true");
    });

    document.body.classList.remove("modal-open");

    if (hadOpenModal && lastFocusedElement instanceof HTMLElement) {
        lastFocusedElement.focus();
    }
}

function atraparFocoModal(event) {
    if (event.key !== "Tab") return;

    const modal = document.querySelector(".modal.show");
    if (!modal) return;

    const focusables = [...modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.hidden && element.offsetParent !== null);

    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

/* =========================
   SISTEMA DE GUARDADO UI
   ========================= */

function prepararBotonesSistema() {
    const exportBtn = document.getElementById("export-save-button");
    const importBtn = document.getElementById("import-save-button");
    const importInput = document.getElementById("import-input");
    const resetBtn = document.getElementById("reset-save-button");

    exportBtn?.addEventListener("click", exportarPartida);

    importBtn?.addEventListener("click", () => {
        importInput?.click();
    });

    importInput?.addEventListener("change", importarPartida);

    resetBtn?.addEventListener("click", () => {
        const ok = confirm("¿Seguro que quieres reiniciar la partida? Esta acción no se puede deshacer.");
        if (!ok) return;

        gameState = crearEstadoBase();
        normalizarEstado();
        guardar();
        location.reload();
    });
}

function guardar() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }

    if (window.SaveSystem?.save) {
        return window.SaveSystem.save(gameState);
    }

    localStorage.setItem("tototo_save_v2", JSON.stringify(gameState));
    return true;
}

function programarGuardado(delay = 350) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        guardar();
    }, delay);
}

function exportarPartida() {
    guardar();

    const blob = new Blob([JSON.stringify(gameState, null, 2)], {
        type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "tototo_clicker_v2_save.json";
    link.click();

    URL.revokeObjectURL(url);

    toast("Partida exportada.", "success");
}

function importarPartida(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = e => {
        try {
            const imported = JSON.parse(e.target.result);
            gameState = imported;
            normalizarEstado();
            guardar();
            toast("Partida importada correctamente.", "success");
            location.reload();
        } catch (error) {
            console.error(error);
            toast("No se pudo importar la partida.", "danger");
        }
    };

    reader.readAsText(file);
}

/* =========================
   EXPERIENCIA, AJUSTES Y PWA
   ========================= */

function aplicarProgresoOffline() {
    const lastPlayedAt = Number(gameState.stats.lastPlayedAt) || Date.now();
    const elapsedSeconds = clamp(Math.floor((Date.now() - lastPlayedAt) / 1000), 0, MAX_OFFLINE_SECONDS);

    if (elapsedSeconds < 60 || gameState.totalPassive <= 0) {
        gameState.stats.lastPlayedAt = Date.now();
        return 0;
    }

    const reward = Math.floor(elapsedSeconds * gameState.totalPassive);
    gameState.coins += reward;
    gameState.stats.coinsEarned += reward;
    gameState.stats.lastPlayedAt = Date.now();
    guardar();
    return reward;
}

function restaurarUltimaPestana() {
    const savedTab = localStorage.getItem(LAST_TAB_KEY) || "inicio";
    cambiarTab(document.getElementById(`tab-${savedTab}`) ? savedTab : "inicio", { persist: false });
}

function prepararAjustesRapidos() {
    const soundButton = document.getElementById("sound-toggle-button");
    const themeButton = document.getElementById("theme-toggle-button");

    soundButton?.addEventListener("click", () => {
        const enabled = window.Sounds?.toggle?.() ?? true;
        actualizarBotonesAjustes(enabled);
        toast(enabled ? "Sonido activado." : "Sonido desactivado.", "success");
    });

    themeButton?.addEventListener("click", () => {
        const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        gameState.settings.theme = nextTheme;
        localStorage.setItem("tototo_theme", nextTheme);
        aplicarTema(nextTheme);
        guardar();
    });

    actualizarBotonesAjustes();
}

function aplicarTemaGuardado() {
    const preferred = gameState.settings?.theme || localStorage.getItem("tototo_theme") || "auto";
    localStorage.setItem("tototo_theme", preferred);
    aplicarTema(preferred);
}

function aplicarTema(theme) {
    const resolved = theme === "auto"
        ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;

    document.documentElement.dataset.theme = resolved;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    themeMeta?.setAttribute("content", resolved === "dark" ? "#0b0c11" : "#17171f");
    actualizarBotonesAjustes();
}

function actualizarBotonesAjustes(soundEnabled = window.Sounds?.isEnabled?.() ?? true) {
    const soundButton = document.getElementById("sound-toggle-button");
    const themeButton = document.getElementById("theme-toggle-button");
    const isDark = document.documentElement.dataset.theme === "dark";

    if (soundButton) {
        soundButton.textContent = soundEnabled ? "🔊" : "🔇";
        soundButton.setAttribute("aria-pressed", String(soundEnabled));
        soundButton.setAttribute("aria-label", soundEnabled ? "Desactivar sonido" : "Activar sonido");
    }

    if (themeButton) {
        themeButton.textContent = isDark ? "☀️" : "🌙";
        themeButton.setAttribute("aria-pressed", String(isDark));
        themeButton.setAttribute("aria-label", isDark ? "Usar tema claro" : "Usar tema oscuro");
    }
}

function actualizarPantallaCarga(message) {
    setText("loading-message", message);
}

function ocultarPantallaCarga() {
    document.getElementById("loading-screen")?.classList.add("is-hidden");
}

function mostrarErrorCarga(error) {
    const screen = document.getElementById("loading-screen");
    const retry = document.getElementById("loading-retry-button");

    screen?.classList.add("is-error");
    setText("loading-title", "No se pudo iniciar el juego");
    setText("loading-message", error?.message || "Error desconocido al cargar los datos.");
    retry?.classList.remove("hidden");
    retry?.addEventListener("click", () => location.reload(), { once: true });
}

function actualizarEstadoAplicacion() {
    const status = document.getElementById("app-status");
    if (!status) return;

    const labels = {
        online: "datos actualizados",
        cache: "datos en caché",
        offline: "modo sin conexión"
    };

    status.dataset.networkStatus = DATA_SOURCE;
    status.textContent = `Versión ${APP_VERSION} · ${labels[DATA_SOURCE] || labels.online}`;
}

function prepararInstalacionPWA() {
    const installButton = document.getElementById("install-app-button");

    window.addEventListener("beforeinstallprompt", event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        installButton?.classList.remove("hidden");
    });

    installButton?.addEventListener("click", async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        installButton.classList.add("hidden");
    });

    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        installButton?.classList.add("hidden");
        toast("Juego instalado correctamente.", "success");
    });
}

function registrarServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

    navigator.serviceWorker.register("./sw.js").catch(error => {
        console.warn("No se pudo registrar el service worker:", error);
    });
}

/* =========================
   UTILIDADES
   ========================= */

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function formatNumber(value) {
    const number = Number(value) || 0;

    return new Intl.NumberFormat("es-ES", {
        maximumFractionDigits: 0
    }).format(number);
}

function formatDecimal(value, decimals = 2) {
    const number = Number(value) || 0;

    return new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(number);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function porcentaje(actual, total) {
    if (!total) return 0;
    return clamp((actual / total) * 100, 0, 100);
}

function toast(message, type = "default", duration = 3000) {
    const container = document.getElementById("toast-container");
    if (!container) {
        console.log(message);
        return;
    }

    const div = document.createElement("div");
    div.className = `toast ${type}`;
    div.textContent = message;

    container.appendChild(div);

    setTimeout(() => {
        div.style.opacity = "0";
        div.style.transform = "translateY(8px)";
        setTimeout(() => div.remove(), 180);
    }, duration);
}

function elegirAleatorio(lista) {
    if (!Array.isArray(lista) || lista.length === 0) return null;
    return lista[Math.floor(Math.random() * lista.length)];
}

function ahoraISO() {
    return new Date().toISOString();
}

/* =========================
   API GLOBAL PARA MÓDULOS
   ========================= */

window.Tototo = {
    getState: () => gameState,
    setState: newState => {
        gameState = newState;
        normalizarEstado();
        window.CollectionHub?.ensureState?.();
        window.CollectionHub?.checkAllBonuses?.({ notify: false });
        recalcularDerivados();
        guardar();
        renderTodo();
    },

    getCards: () => BASE_DE_CROMOS,
    getAlbums: () => CONFIG_ALBUMES,
    getShopPacks: () => SOBRES_TIENDA,
    getRarities: () => RAREZAS,

    getCardsByAlbum: getCromosDeAlbum,
    isAlbumComplete: albumEstaCompleto,
    getMainAlbumOfCard: getAlbumPrincipalDeCromo,
    getBaseTagOfAlbum: getTagBaseDeAlbum,

    earnCoins: ganarMonedas,
    spendCoins: gastarMonedas,

    recalculate: recalcularDerivados,
    renderAll: renderTodo,
    renderLight: renderTodoLigero,
    renderBackpack: renderMochila,

    save: guardar,
    queueSave: programarGuardado,

    openModal: abrirModal,
    closeModals: cerrarModales,
    changeTab: cambiarTab,

    setAchievementFilter: filter => {
        CURRENT_ACHIEVEMENT_FILTER = filter;
    },
    getAchievementFilter: () => CURRENT_ACHIEVEMENT_FILTER,

    setCurrentAlbum: albumId => {
        CURRENT_ALBUM_ID = albumId;
    },
    getCurrentAlbum: () => CURRENT_ALBUM_ID,

    toast,
    formatNumber,
    formatDecimal,
    escapeHTML,
    clamp,
    percentage: porcentaje,
    randomFrom: elegirAleatorio,
    nowISO: ahoraISO
};
