/* =========================================================
   TOTOTO CLICKER 2.2 - COLLECTION.JS
   Favoritos, vitrina y bonificaciones permanentes por conjuntos.
   ========================================================= */

window.CollectionHub = (() => {
    const MAX_SHOWCASE_CARDS = 6;

    const BONUS_DEFINITIONS = [
        {
            id: "r_set",
            rarities: ["R"],
            title: "Conjunto R",
            description: "+2% poder de click",
            effect: "click",
            amount: 0.02,
            icon: "👆"
        },
        {
            id: "sr_set",
            rarities: ["SR"],
            title: "Conjunto SR",
            description: "+5% producción pasiva",
            effect: "passive",
            amount: 0.05,
            icon: "⚙️"
        },
        {
            id: "elite_set",
            rarities: ["SSR", "UR"],
            title: "Conjunto élite",
            description: "+5% fragmentos por duplicado",
            effect: "fragments",
            amount: 0.05,
            icon: "♻️"
        }
    ];

    function ensureState() {
        const state = window.Tototo?.getState?.();
        if (!state) return null;

        if (!Array.isArray(state.favorites)) state.favorites = [];
        if (!Array.isArray(state.showcase)) state.showcase = [];
        if (!state.collectionBonuses || typeof state.collectionBonuses !== "object" || Array.isArray(state.collectionBonuses)) {
            state.collectionBonuses = {};
        }

        state.favorites = [...new Set(state.favorites.map(String))];
        state.showcase = [...new Set(state.showcase.map(String))].slice(0, MAX_SHOWCASE_CARDS);

        return state;
    }

    function checkAllBonuses({ notify = false } = {}) {
        const albums = window.Tototo?.getAlbums?.() || [];
        let unlocked = 0;

        albums.forEach(album => {
            unlocked += checkAlbumBonuses(album.id, { notify });
        });

        return unlocked;
    }

    function checkAlbumBonuses(albumId, { notify = true } = {}) {
        const state = ensureState();
        if (!state) return 0;

        const album = window.Tototo.getAlbums().find(item => item.id === albumId);
        if (!album) return 0;

        if (!state.collectionBonuses[albumId] || typeof state.collectionBonuses[albumId] !== "object") {
            state.collectionBonuses[albumId] = {};
        }

        let unlocked = 0;

        BONUS_DEFINITIONS.forEach(definition => {
            if (state.collectionBonuses[albumId][definition.id]) return;

            const progress = getDefinitionProgress(albumId, definition);
            if (!progress.complete) return;

            state.collectionBonuses[albumId][definition.id] = true;
            unlocked += 1;

            if (notify) {
                window.Tototo.toast(
                    `${definition.icon} Bonus de ${album.nombre}: ${definition.description}.`,
                    "success",
                    4500
                );
                window.Sounds?.play?.("achievement");
            }
        });

        return unlocked;
    }

    function getDefinitionProgress(albumId, definition) {
        const state = ensureState();
        const cards = window.Tototo.getCardsByAlbum(albumId)
            .filter(card => definition.rarities.includes(card.rareza));
        const owned = cards.filter(card => state?.inventario.includes(card.id)).length;

        return {
            owned,
            total: cards.length,
            complete: cards.length > 0 && owned === cards.length,
            unlocked: Boolean(state?.collectionBonuses?.[albumId]?.[definition.id])
        };
    }

    function getAlbumBonusProgress(albumId) {
        return BONUS_DEFINITIONS.map(definition => ({
            ...definition,
            ...getDefinitionProgress(albumId, definition)
        }));
    }

    function getUnlockedBonusCount(effect = null) {
        const state = ensureState();
        if (!state) return 0;

        let count = 0;
        Object.values(state.collectionBonuses).forEach(albumBonuses => {
            BONUS_DEFINITIONS.forEach(definition => {
                if ((!effect || definition.effect === effect) && albumBonuses?.[definition.id]) {
                    count += 1;
                }
            });
        });

        return count;
    }

    function getClickMultiplier() {
        return 1 + getUnlockedBonusCount("click") * 0.02;
    }

    function getPassiveMultiplier() {
        return 1 + getUnlockedBonusCount("passive") * 0.05;
    }

    function getFragmentMultiplier() {
        return 1 + getUnlockedBonusCount("fragments") * 0.05;
    }

    function getEffectSummary() {
        return {
            clickPercent: Math.round((getClickMultiplier() - 1) * 100),
            passivePercent: Math.round((getPassiveMultiplier() - 1) * 100),
            fragmentPercent: Math.round((getFragmentMultiplier() - 1) * 100),
            unlocked: getUnlockedBonusCount(),
            total: (window.Tototo?.getAlbums?.().length || 0) * BONUS_DEFINITIONS.length
        };
    }

    function toggleFavorite(cardId) {
        const state = ensureState();
        const card = getOwnedCard(cardId);
        if (!state || !card) {
            window.Tototo.toast("Solo puedes marcar como favorito un cromo obtenido.", "warning");
            return false;
        }

        const index = state.favorites.indexOf(card.id);
        const adding = index === -1;

        if (adding) {
            state.favorites.push(card.id);
        } else {
            state.favorites.splice(index, 1);
            removeFromShowcase(card.id, { silent: true });
        }

        window.Tototo.save();
        render();
        window.Albums?.render?.();
        window.Tototo.toast(adding ? "Cromo añadido a favoritos." : "Cromo retirado de favoritos.", "success");
        return adding;
    }

    function toggleShowcase(cardId) {
        const state = ensureState();
        const card = getOwnedCard(cardId);
        if (!state || !card) {
            window.Tototo.toast("Solo puedes exponer un cromo obtenido.", "warning");
            return false;
        }

        const index = state.showcase.indexOf(card.id);
        const adding = index === -1;

        if (adding) {
            if (state.showcase.length >= MAX_SHOWCASE_CARDS) {
                window.Tototo.toast(`La vitrina ya tiene ${MAX_SHOWCASE_CARDS} cromos. Quita uno primero.`, "warning");
                window.Sounds?.play?.("error");
                return false;
            }

            if (!state.favorites.includes(card.id)) state.favorites.push(card.id);
            state.showcase.push(card.id);
        } else {
            state.showcase.splice(index, 1);
        }

        window.Tototo.save();
        render();
        window.Albums?.render?.();
        window.Tototo.toast(adding ? "Cromo añadido a la vitrina." : "Cromo retirado de la vitrina.", "success");
        return adding;
    }

    function removeFromShowcase(cardId, { silent = false } = {}) {
        const state = ensureState();
        if (!state) return false;

        const index = state.showcase.indexOf(String(cardId));
        if (index === -1) return false;

        state.showcase.splice(index, 1);
        if (!silent) {
            window.Tototo.save();
            render();
        }
        return true;
    }

    function pruneUnavailable() {
        const state = ensureState();
        if (!state) return;

        const owned = new Set(state.inventario.map(String));
        state.favorites = state.favorites.filter(cardId => owned.has(String(cardId)));
        state.showcase = state.showcase.filter(cardId => owned.has(String(cardId))).slice(0, MAX_SHOWCASE_CARDS);
    }

    function isFavorite(cardId) {
        const state = ensureState();
        return Boolean(state?.favorites.includes(String(cardId)));
    }

    function isShowcased(cardId) {
        const state = ensureState();
        return Boolean(state?.showcase.includes(String(cardId)));
    }

    function render() {
        const state = ensureState();
        if (!state) return;

        pruneUnavailable();
        renderShowcase(state);
        renderFavorites(state);
        renderBonusSummary();
    }

    function renderShowcase(state) {
        const container = document.getElementById("showcase-grid");
        const count = document.getElementById("showcase-count");
        if (!container) return;

        const cards = state.showcase
            .map(cardId => window.Tototo.getCards().find(card => card.id === cardId))
            .filter(Boolean);

        if (count) count.textContent = `${cards.length} / ${MAX_SHOWCASE_CARDS}`;

        const filledSlots = cards.map(card => renderCollectionCard(card, { showcase: true }));
        const emptySlots = Array.from({ length: MAX_SHOWCASE_CARDS - cards.length }, (_, index) => `
            <div class="showcase-slot empty-showcase-slot" aria-label="Hueco libre ${index + 1}">
                <span>＋</span>
                <small>Hueco libre</small>
            </div>
        `);

        container.innerHTML = [...filledSlots, ...emptySlots].join("");
        bindCollectionCards(container);
    }

    function renderFavorites(state) {
        const container = document.getElementById("favorite-grid");
        const count = document.getElementById("favorite-count");
        if (!container) return;

        const rarityOrder = { UR: 5, SSR: 4, SR: 3, R: 2, N: 1 };
        const cards = state.favorites
            .map(cardId => window.Tototo.getCards().find(card => card.id === cardId))
            .filter(Boolean)
            .sort((a, b) => (rarityOrder[b.rareza] || 0) - (rarityOrder[a.rareza] || 0) || a.nombre.localeCompare(b.nombre, "es"));

        if (count) count.textContent = window.Tototo.formatNumber(cards.length);

        container.innerHTML = cards.length
            ? cards.map(card => renderCollectionCard(card, { favorite: true })).join("")
            : '<div class="empty-state">Todavía no tienes favoritos. Abre la ficha de un cromo obtenido y pulsa “Añadir a favoritos”.</div>';

        bindCollectionCards(container);
    }

    function renderCollectionCard(card, { showcase = false, favorite = false } = {}) {
        return `
            <article class="collection-card ${showcase ? "showcase-slot" : ""}">
                <button class="collection-card-open" type="button" data-collection-open="${window.Tototo.escapeHTML(card.id)}">
                    <span class="collection-card-badges">
                        ${isShowcased(card.id) ? '<span title="En vitrina">🏛️</span>' : ""}
                        ${isFavorite(card.id) ? '<span title="Favorito">⭐</span>' : ""}
                    </span>
                    <img src="${window.Tototo.escapeHTML(card.imagen)}"
                         alt="${window.Tototo.escapeHTML(card.nombre)}"
                         class="cromo-img rareza-${window.Tototo.escapeHTML(card.rareza)}"
                         loading="lazy"
                         onerror="this.style.opacity='0.25'">
                    <strong>${window.Tototo.escapeHTML(card.nombre)}</strong>
                    <small>${window.Tototo.escapeHTML(card.rareza)}</small>
                </button>
                <button class="secondary-button compact-button" type="button"
                        data-collection-action="${showcase ? "showcase" : favorite ? "favorite" : "favorite"}"
                        data-card-id="${window.Tototo.escapeHTML(card.id)}">
                    ${showcase ? "Quitar de vitrina" : "Quitar favorito"}
                </button>
            </article>
        `;
    }

    function bindCollectionCards(container) {
        container.querySelectorAll("[data-collection-open]").forEach(button => {
            button.addEventListener("click", () => window.Encyclopedia?.openCard?.(button.dataset.collectionOpen));
        });

        container.querySelectorAll("[data-collection-action]").forEach(button => {
            button.addEventListener("click", () => {
                if (button.dataset.collectionAction === "showcase") {
                    toggleShowcase(button.dataset.cardId);
                } else {
                    toggleFavorite(button.dataset.cardId);
                }
            });
        });
    }

    function renderBonusSummary() {
        const container = document.getElementById("collection-bonus-summary");
        if (!container) return;

        const summary = getEffectSummary();
        container.innerHTML = `
            <div class="progress-line"><span>Bonificaciones desbloqueadas</span><strong>${summary.unlocked} / ${summary.total}</strong></div>
            <div class="progress-line"><span>Poder de click</span><strong>+${summary.clickPercent}%</strong></div>
            <div class="progress-line"><span>Producción pasiva</span><strong>+${summary.passivePercent}%</strong></div>
            <div class="progress-line"><span>Fragmentos por duplicado</span><strong>+${summary.fragmentPercent}%</strong></div>
        `;
    }

    function renderCardActions(card, owned) {
        const favorite = isFavorite(card.id);
        const showcased = isShowcased(card.id);
        const showcaseFull = (ensureState()?.showcase.length || 0) >= MAX_SHOWCASE_CARDS;

        return `
            <div class="card-collection-actions">
                <button class="secondary-button" type="button" data-detail-favorite="${window.Tototo.escapeHTML(card.id)}" ${owned ? "" : "disabled"}>
                    ${favorite ? "★ Quitar de favoritos" : "☆ Añadir a favoritos"}
                </button>
                <button class="secondary-button" type="button" data-detail-showcase="${window.Tototo.escapeHTML(card.id)}"
                        ${owned && (showcased || !showcaseFull) ? "" : "disabled"}>
                    ${showcased ? "🏛️ Quitar de vitrina" : "🏛️ Exponer en vitrina"}
                </button>
            </div>
        `;
    }

    function bindCardDetailActions(cardId) {
        const id = String(cardId);
        const favoriteButton = [...document.querySelectorAll("[data-detail-favorite]")]
            .find(button => button.dataset.detailFavorite === id);
        const showcaseButton = [...document.querySelectorAll("[data-detail-showcase]")]
            .find(button => button.dataset.detailShowcase === id);

        favoriteButton?.addEventListener("click", () => {
            toggleFavorite(cardId);
            window.Encyclopedia?.openCard?.(cardId);
        });

        showcaseButton?.addEventListener("click", () => {
            toggleShowcase(cardId);
            window.Encyclopedia?.openCard?.(cardId);
        });
    }

    function getOwnedCard(cardId) {
        const state = ensureState();
        const id = String(cardId);
        if (!state?.inventario.includes(id)) return null;
        return window.Tototo.getCards().find(card => card.id === id) || null;
    }

    return {
        ensureState,
        checkAllBonuses,
        checkAlbumBonuses,
        getAlbumBonusProgress,
        getUnlockedBonusCount,
        getClickMultiplier,
        getPassiveMultiplier,
        getFragmentMultiplier,
        getEffectSummary,
        toggleFavorite,
        toggleShowcase,
        isFavorite,
        isShowcased,
        pruneUnavailable,
        render,
        renderCardActions,
        bindCardDetailActions,
        BONUS_DEFINITIONS,
        MAX_SHOWCASE_CARDS
    };
})();
