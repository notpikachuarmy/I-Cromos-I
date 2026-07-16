/* =========================================================
   TOTOTO CLICKER 2.2 - SHOP.JS
   Tienda, apertura múltiple, automatismos e historial.
   ========================================================= */

window.Shop = (() => {
    const FRAGMENTOS_POR_SOBRE = 50;
    const MAX_BATCH_OPEN = 50000;
    const MAX_HISTORY_ENTRIES = 20;
    const MAX_SUMMARY_CARDS = 80;

    const BASE_RARITY_CHANCES = {
        N: 0.60,
        R: 0.25,
        SR: 0.10,
        SSR: 0.04,
        UR: 0.01
    };

    const DUPLICATE_FRAGMENT_VALUES = {
        N: 1,
        R: 2,
        SR: 5,
        SSR: 10,
        UR: 25
    };

    const SMART_UPGRADES = {
        stopOnUR: "auto_stop_ur",
        stopOnAlbumComplete: "auto_stop_album",
        compactSummary: "compact_pack_summary"
    };

    function render() {
        const container = document.getElementById("pack-list");
        if (!container) return;

        const packs = window.Tototo.getShopPacks();
        const state = window.Tototo.getState();
        const packIds = Object.keys(packs);
        const selection = getOpenSelection();

        ensureShopState();
        renderSmartControls();
        renderHistory();

        if (!packIds.length) {
            container.innerHTML = `<div class="empty-state">No hay sobres disponibles.</div>`;
            return;
        }

        container.innerHTML = packIds.map(packId => {
            const pack = packs[packId];
            const tagBase = getTagBase(pack);
            const fragments = state.fragmentos[tagBase] || 0;
            const cost = getPackCost(pack);
            const coinAmount = resolveAmount(pack, false, selection);
            const fragmentAmount = resolveAmount(pack, true, selection);
            const displayAmount = selection.mode === "max" ? "máximo" : window.Tototo.formatNumber(selection.amount);
            const previewCoinAmount = selection.mode === "max" ? coinAmount.amount : selection.amount;
            const previewFragmentAmount = selection.mode === "max" ? fragmentAmount.amount : selection.amount;
            const totalCost = cost * previewCoinAmount;
            const totalFragments = FRAGMENTOS_POR_SOBRE * previewFragmentAmount;

            return `
                <article class="shop-card">
                    <img src="${window.Tototo.escapeHTML(pack.portada)}"
                         alt="Sobre ${window.Tototo.escapeHTML(pack.nombre || pack.id)}"
                         class="pack-img"
                         loading="lazy"
                         onerror="this.style.opacity='0.25'">

                    <h3>${window.Tototo.escapeHTML(pack.nombre || pack.id)}</h3>

                    <p>Coste por sobre: <strong class="money">${window.Tototo.formatNumber(cost)} 🪙</strong></p>
                    <p>
                        ${selection.mode === "max" ? "Puedes abrir" : `Coste x${displayAmount}`}:
                        <strong class="money">
                            ${selection.mode === "max"
                                ? `${window.Tototo.formatNumber(coinAmount.amount)} sobres`
                                : `${window.Tototo.formatNumber(totalCost)} 🪙`}
                        </strong>
                    </p>

                    <p>
                        Fragmentos ${window.Tototo.escapeHTML(tagBase)}:
                        <strong>${window.Tototo.formatNumber(fragments)}${selection.mode === "max" ? ` · ${window.Tototo.formatNumber(fragmentAmount.amount)} sobres` : ` / ${window.Tototo.formatNumber(totalFragments)}`}</strong>
                    </p>

                    <div class="shop-actions">
                        <button class="card-button full-button"
                                type="button"
                                data-buy-pack="${window.Tototo.escapeHTML(pack.id)}"
                                ${coinAmount.amount > 0 ? "" : "disabled"}>
                            Comprar ${selection.mode === "max" ? `máximo (${window.Tototo.formatNumber(coinAmount.amount)})` : `x${displayAmount}`}
                        </button>

                        <button class="secondary-button full-button"
                                type="button"
                                data-exchange-pack="${window.Tototo.escapeHTML(pack.id)}"
                                ${fragmentAmount.amount > 0 ? "" : "disabled"}>
                            Canjear ${selection.mode === "max" ? `máximo (${window.Tototo.formatNumber(fragmentAmount.amount)})` : `x${displayAmount}`}
                        </button>
                    </div>
                </article>
            `;
        }).join("");

        bindShopButtons();
        bindAmountSelector();
    }

    function ensureShopState() {
        const state = window.Tototo.getState();

        if (!state.settings.smartOpening || typeof state.settings.smartOpening !== "object") {
            state.settings.smartOpening = {
                stopOnUR: false,
                stopOnAlbumComplete: false,
                compactSummary: false
            };
        }

        if (!Array.isArray(state.packHistory)) state.packHistory = [];
        state.packHistory = state.packHistory.slice(0, MAX_HISTORY_ENTRIES);
        if (!state.bestOpening || typeof state.bestOpening !== "object") state.bestOpening = null;
    }

    function bindShopButtons() {
        document.querySelectorAll("[data-buy-pack]").forEach(button => {
            if (button.dataset.boundShopBuy) return;
            button.dataset.boundShopBuy = "true";
            button.addEventListener("click", () => comprarSobre(button.dataset.buyPack, false));
        });

        document.querySelectorAll("[data-exchange-pack]").forEach(button => {
            if (button.dataset.boundShopExchange) return;
            button.dataset.boundShopExchange = "true";
            button.addEventListener("click", () => comprarSobre(button.dataset.exchangePack, true));
        });
    }

    function bindAmountSelector() {
        const selector = document.getElementById("pack-open-amount");
        if (!selector || selector.dataset.boundPackAmount) return;

        selector.dataset.boundPackAmount = "true";
        selector.addEventListener("change", render);
    }

    function renderSmartControls() {
        ensureShopState();
        const settings = window.Tototo.getState().settings.smartOpening;
        const panel = document.getElementById("smart-opening-panel");
        const controls = {
            stopOnUR: document.getElementById("smart-stop-ur"),
            stopOnAlbumComplete: document.getElementById("smart-stop-album"),
            compactSummary: document.getElementById("smart-summary-filter")
        };

        let visibleOptions = 0;

        Object.entries(controls).forEach(([key, input]) => {
            if (!input) return;

            const unlocked = isSmartFeatureUnlocked(key);
            const option = input.closest(".smart-option");

            if (option) option.hidden = !unlocked;
            input.disabled = !unlocked;
            input.checked = unlocked && Boolean(settings[key]);

            if (unlocked) visibleOptions += 1;

            if (!input.dataset.boundSmartOption) {
                input.dataset.boundSmartOption = "true";
                input.addEventListener("change", () => {
                    ensureShopState();
                    window.Tototo.getState().settings.smartOpening[key] = Boolean(input.checked) && isSmartFeatureUnlocked(key);
                    window.Tototo.save();
                });
            }
        });

        if (panel) panel.hidden = visibleOptions === 0;
    }

    function isSmartFeatureUnlocked(key) {
        const upgradeId = SMART_UPGRADES[key];
        return Boolean(upgradeId && window.Upgrades?.isOwned?.(upgradeId));
    }

    function getSmartSettings() {
        ensureShopState();
        const raw = window.Tototo.getState().settings.smartOpening;

        return {
            stopOnUR: isSmartFeatureUnlocked("stopOnUR") && Boolean(raw.stopOnUR),
            stopOnAlbumComplete: isSmartFeatureUnlocked("stopOnAlbumComplete") && Boolean(raw.stopOnAlbumComplete),
            compactSummary: isSmartFeatureUnlocked("compactSummary") && Boolean(raw.compactSummary)
        };
    }

    function getOpenSelection() {
        const value = document.getElementById("pack-open-amount")?.value || "1";
        if (value === "max") return { mode: "max", amount: null };

        const numeric = Number(value);
        const allowed = [1, 5, 10, 25, 100, 250];
        return { mode: "fixed", amount: allowed.includes(numeric) ? numeric : 1 };
    }

    function resolveAmount(pack, conFragmentos, selection = getOpenSelection()) {
        const state = window.Tototo.getState();
        const unitCost = conFragmentos ? FRAGMENTOS_POR_SOBRE : getPackCost(pack);
        const resource = conFragmentos
            ? (state.fragmentos[getTagBase(pack)] || 0)
            : state.coins;
        const affordable = Math.max(0, Math.floor(resource / unitCost));

        if (selection.mode === "max") {
            return {
                amount: Math.min(affordable, MAX_BATCH_OPEN),
                affordable,
                capped: affordable > MAX_BATCH_OPEN
            };
        }

        return {
            amount: affordable >= selection.amount ? selection.amount : 0,
            affordable,
            capped: false
        };
    }

    function comprarSobre(packId, conFragmentos = false) {
        const packs = window.Tototo.getShopPacks();
        const pack = packs[packId];

        if (!pack) {
            window.Tototo.toast("Ese sobre no existe.", "danger");
            window.Sounds?.play?.("error");
            return 0;
        }

        const availableCards = getAvailableCards(pack);
        if (!availableCards.length) {
            window.Tototo.toast("Este sobre no tiene cromos disponibles. Revisa tags y CSV.", "danger");
            window.Sounds?.play?.("error");
            return 0;
        }

        const selection = getOpenSelection();
        const resolved = resolveAmount(pack, conFragmentos, selection);
        const requestedAmount = resolved.amount;

        if (requestedAmount <= 0) {
            window.Tototo.toast(
                conFragmentos ? "No tienes fragmentos suficientes." : "No tienes monedas suficientes.",
                "warning"
            );
            window.Sounds?.play?.("error");
            return 0;
        }

        const state = window.Tototo.getState();
        const settings = getSmartSettings();
        const albumWasComplete = window.Tototo.isAlbumComplete(pack.id);
        const results = [];
        const stopReasons = [];
        const summary = {
            solicitados: requestedAmount,
            abiertos: 0,
            nuevos: 0,
            duplicados: 0,
            fragmentosTotales: 0,
            rarezas: { N: 0, R: 0, SR: 0, SSR: 0, UR: 0 },
            capped: resolved.capped,
            source: conFragmentos ? "fragmentos" : "monedas"
        };

        for (let index = 0; index < requestedAmount; index += 1) {
            const prize = obtenerCromoDeSobre(pack, availableCards);
            if (!prize) break;

            const result = registrarPremio(pack, prize, { notify: requestedAmount === 1 });
            results.push(result);
            summary.abiertos += 1;
            summary.rarezas[prize.rareza] = (summary.rarezas[prize.rareza] || 0) + 1;

            if (result.isDuplicate) {
                summary.duplicados += 1;
                summary.fragmentosTotales += result.fragmentsEarned;
            } else {
                summary.nuevos += 1;
            }

            const reachedUR = settings.stopOnUR && prize.rareza === "UR";
            const completedAlbum = settings.stopOnAlbumComplete
                && !albumWasComplete
                && window.Tototo.isAlbumComplete(pack.id);

            if (reachedUR) stopReasons.push("UR conseguida");
            if (completedAlbum) stopReasons.push("álbum completado");
            if (reachedUR || completedAlbum) break;
        }

        if (!summary.abiertos) {
            window.Tototo.toast("No se pudo abrir ningún sobre.", "danger");
            return 0;
        }

        chargeOpening(pack, summary.abiertos, conFragmentos);

        window.Missions?.onProgress?.("packs", summary.abiertos);
        if (summary.nuevos > 0) window.Missions?.onProgress?.("newCards", summary.nuevos);
        if (summary.fragmentosTotales > 0) window.Missions?.onProgress?.("fragments", summary.fragmentosTotales);

        window.CollectionHub?.checkAlbumBonuses?.(pack.id, { notify: true });

        const historyEntry = registerOpeningHistory(pack, summary, results, stopReasons, conFragmentos);

        if (summary.abiertos === 1 && requestedAmount === 1) {
            const result = results[0];
            mostrarResultadoSobre(pack, result.prize, result.isDuplicate, result.fragmentsEarned);
        } else {
            mostrarResumenMultiple(summary, results, stopReasons, settings.compactSummary);
        }

        const stopText = stopReasons.length ? ` Apertura detenida: ${stopReasons.join(" y ")}.` : "";
        const capText = resolved.capped ? ` Se aplicó el límite de ${window.Tototo.formatNumber(MAX_BATCH_OPEN)} sobres por operación.` : "";
        window.Tototo.toast(
            `Has abierto ${window.Tototo.formatNumber(summary.abiertos)} sobres.${stopText}${capText}`,
            "success",
            stopReasons.length || resolved.capped ? 5000 : 3000
        );

        if (summary.rarezas.UR > 0) {
            window.Sounds?.play?.("ur");
        } else if (summary.abiertos > 1) {
            window.Sounds?.play?.("buy");
        }

        refrescarTrasCompra();
        renderHistory(historyEntry);
        return summary.abiertos;
    }

    function chargeOpening(pack, amount, conFragmentos) {
        const state = window.Tototo.getState();

        if (conFragmentos) {
            const tagBase = getTagBase(pack);
            const totalFragmentsCost = FRAGMENTOS_POR_SOBRE * amount;
            state.fragmentos[tagBase] = Math.max(0, (state.fragmentos[tagBase] || 0) - totalFragmentsCost);
            window.Statistics?.registerFragmentsSpent?.(totalFragmentsCost);
            return;
        }

        window.Tototo.spendCoins(getPackCost(pack) * amount, { render: false });
    }

    function registrarPremio(pack, prize, { notify = false } = {}) {
        const state = window.Tototo.getState();
        const tagBase = getTagBase(pack);
        const isDuplicate = state.inventario.includes(prize.id);
        let fragmentsEarned = 0;

        if (isDuplicate) {
            fragmentsEarned = calcularFragmentosDuplicado(prize);
            const tagDestino = getTagDestinoFragmentos(prize, tagBase);
            state.fragmentos[tagDestino] = (state.fragmentos[tagDestino] || 0) + fragmentsEarned;

            if (notify) {
                window.Tototo.toast(
                    `Duplicado: ${prize.nombre}. +${fragmentsEarned} fragmentos ${tagDestino}.`,
                    "warning"
                );
                window.Sounds?.play?.("duplicate");
            }
        } else {
            state.inventario.push(prize.id);

            if (notify) {
                window.Tototo.toast(`Nuevo cromo: ${prize.nombre} (${prize.rareza})`, "success");
                window.Sounds?.play?.(prize.rareza === "UR" ? "ur" : "newCard");
            }
        }

        window.Statistics?.registerPackOpened?.(pack.id);
        window.Statistics?.registerCardObtained?.(prize, isDuplicate, fragmentsEarned);
        window.Encyclopedia?.registerCard?.(prize, isDuplicate, fragmentsEarned, false);

        return { prize, isDuplicate, fragmentsEarned };
    }

    function refrescarTrasCompra() {
        window.Tototo.recalculate();
        window.Tototo.save();

        render();
        window.Tototo.renderBackpack?.();
        window.Albums?.render?.();
        window.CollectionHub?.render?.();
        window.Statistics?.renderIfVisible?.();
        window.Albums?.checkAllAlbumCompletionRewards?.();
        window.Achievements?.checkAll?.();
        window.Missions?.render?.();
        window.Upgrades?.renderSummary?.();
        window.Tototo.renderLight();
    }

    function mostrarResumenMultiple(data, results, stopReasons, compactSummary) {
        const body = document.getElementById("pack-result-body");
        const title = document.getElementById("pack-result-title");
        if (!body || !title) return;

        title.textContent = stopReasons.length ? "Apertura inteligente completada" : "Resumen de apertura";

        const visibleResults = compactSummary
            ? results.filter(result => !result.isDuplicate || ["SSR", "UR"].includes(result.prize.rareza))
            : results;
        const limitedResults = visibleResults.slice(0, MAX_SUMMARY_CARDS);
        const omitted = Math.max(0, visibleResults.length - limitedResults.length);

        body.innerHTML = `
            ${stopReasons.length ? `<div class="opening-stop-banner">⏹ Detenida automáticamente: ${window.Tototo.escapeHTML(stopReasons.join(" y "))}</div>` : ""}
            <div class="card-detail-grid opening-summary-grid">
                <div class="card-detail-row"><span>Sobres abiertos</span><strong>${window.Tototo.formatNumber(data.abiertos)}</strong></div>
                <div class="card-detail-row"><span>Nuevos cromos</span><strong class="success-text">${window.Tototo.formatNumber(data.nuevos)}</strong></div>
                <div class="card-detail-row"><span>Duplicados</span><strong>${window.Tototo.formatNumber(data.duplicados)}</strong></div>
                <div class="card-detail-row"><span>Fragmentos obtenidos</span><strong class="money">+${window.Tototo.formatNumber(data.fragmentosTotales)}</strong></div>
            </div>

            <div class="modal-stats opening-rarity-summary">
                ${Object.entries(data.rarezas).map(([rareza, cantidad]) => `
                    <span class="stat-pill rarity-${window.Tototo.escapeHTML(rareza)}">
                        ${window.Tototo.escapeHTML(rareza)}: ${window.Tototo.formatNumber(cantidad)}
                    </span>
                `).join("")}
            </div>

            <div class="opening-result-heading">
                <h3>${compactSummary ? "Nuevos y destacados" : "Resultados"}</h3>
                <span>${window.Tototo.formatNumber(visibleResults.length)} mostrables</span>
            </div>

            ${limitedResults.length
                ? `<div class="opening-result-grid">${limitedResults.map(renderResultCard).join("")}</div>`
                : '<div class="empty-state">No hubo cromos nuevos, SSR ni UR en esta apertura.</div>'}

            ${omitted > 0 ? `<p class="text-muted">Se han ocultado ${window.Tototo.formatNumber(omitted)} resultados adicionales para mantener el resumen ligero.</p>` : ""}

            <button class="secondary-button" type="button" data-result-close>Cerrar</button>
        `;

        bindResultModalActions(body);
        window.Tototo.openModal("pack-result-modal");
    }

    function renderResultCard(result) {
        const card = result.prize;
        return `
            <button class="opening-result-card ${result.isDuplicate ? "duplicate" : "new"}" type="button" data-result-card="${window.Tototo.escapeHTML(card.id)}">
                <img src="${window.Tototo.escapeHTML(card.imagen)}"
                     alt="${window.Tototo.escapeHTML(card.nombre)}"
                     class="cromo-img rareza-${window.Tototo.escapeHTML(card.rareza)}"
                     loading="lazy"
                     onerror="this.style.opacity='0.25'">
                <strong>${window.Tototo.escapeHTML(card.nombre)}</strong>
                <span>${window.Tototo.escapeHTML(card.rareza)} · ${result.isDuplicate ? `Duplicado +${window.Tototo.formatNumber(result.fragmentsEarned)}` : "Nuevo"}</span>
            </button>
        `;
    }

    function bindResultModalActions(body) {
        body.querySelector("[data-result-close]")?.addEventListener("click", () => window.Tototo.closeModals());
        body.querySelectorAll("[data-result-card]").forEach(button => {
            button.addEventListener("click", () => window.Encyclopedia?.openCard?.(button.dataset.resultCard));
        });
    }

    function getAvailableCards(pack) {
        const cards = window.Tototo.getCards();
        const packTags = pack.tags || [];
        return cards.filter(card => card.tags.some(tag => packTags.includes(tag)));
    }

    function obtenerCromoDeSobre(pack, availableCards = null) {
        const posiblesDelPack = availableCards || getAvailableCards(pack);
        if (!posiblesDelPack.length) return null;

        const rarity = tirarRareza();
        const rarityCandidates = posiblesDelPack.filter(card => card.rareza === rarity);
        const candidates = rarityCandidates.length ? rarityCandidates : posiblesDelPack;
        return window.Tototo.randomFrom(candidates);
    }

    function tirarRareza() {
        const chances = getEffectiveRarityChances();
        const roll = Math.random();
        let acumulado = 0;

        for (const rarity of ["UR", "SSR", "SR", "R", "N"]) {
            acumulado += chances[rarity] || 0;
            if (roll < acumulado) return rarity;
        }

        return "N";
    }

    function getEffectiveRarityChances() {
        let chances = { ...BASE_RARITY_CHANCES };
        if (window.Upgrades?.applyRarityBonuses) chances = window.Upgrades.applyRarityBonuses(chances);
        return normalizeChances(chances);
    }

    function normalizeChances(chances) {
        const clean = {};
        let total = 0;

        window.Tototo.getRarities().forEach(rarity => {
            clean[rarity] = Math.max(0, Number(chances[rarity]) || 0);
            total += clean[rarity];
        });

        if (total <= 0) return { ...BASE_RARITY_CHANCES };
        Object.keys(clean).forEach(rarity => clean[rarity] /= total);
        return clean;
    }

    function calcularFragmentosDuplicado(card) {
        let base = DUPLICATE_FRAGMENT_VALUES[card.rareza] || 1;
        if (window.Upgrades?.getFragmentMultiplier) base *= window.Upgrades.getFragmentMultiplier();
        if (window.CollectionHub?.getFragmentMultiplier) base *= window.CollectionHub.getFragmentMultiplier();
        if (window.Upgrades?.getFlatFragmentBonus) base += window.Upgrades.getFlatFragmentBonus();
        return Math.max(1, Math.floor(base));
    }

    function getPackCost(pack) {
        let cost = Number(pack.costo) || 100;
        if (window.Upgrades?.getPackDiscountMultiplier) cost *= window.Upgrades.getPackDiscountMultiplier();
        return Math.max(1, Math.floor(cost));
    }

    function getTagBase(pack) {
        return pack?.tags?.[0] || "GENERAL";
    }

    function getTagDestinoFragmentos(card, fallbackTag) {
        const mainAlbum = window.Tototo.getMainAlbumOfCard(card);
        if (mainAlbum?.tags?.[0]) return mainAlbum.tags[0];
        return card.tags?.[0] || fallbackTag || "GENERAL";
    }

    function mostrarResultadoSobre(pack, card, duplicate, fragmentsEarned) {
        const body = document.getElementById("pack-result-body");
        const title = document.getElementById("pack-result-title");
        if (!body || !title) return;

        title.textContent = duplicate ? "Cromo repetido" : "Nuevo cromo";
        const album = window.Tototo.getMainAlbumOfCard(card);
        const status = duplicate
            ? `Repetido · +${window.Tototo.formatNumber(fragmentsEarned)} fragmentos`
            : "Añadido a la colección";

        body.innerHTML = `
            <img src="${window.Tototo.escapeHTML(card.imagen)}"
                 alt="${window.Tototo.escapeHTML(card.nombre)}"
                 class="cromo-img rareza-${window.Tototo.escapeHTML(card.rareza)}"
                 onerror="this.style.opacity='0.25'">
            <h3>${window.Tototo.escapeHTML(card.nombre)}</h3>
            <div class="modal-stats">
                <span class="stat-pill rarity-${window.Tototo.escapeHTML(card.rareza)}">${window.Tototo.escapeHTML(card.rareza)}</span>
                <span class="stat-pill">${window.Tototo.escapeHTML(album?.nombre || pack.nombre || pack.id)}</span>
            </div>
            <p class="${duplicate ? "money" : "success-text"}">${window.Tototo.escapeHTML(status)}</p>
            <button class="secondary-button" type="button" data-result-card="${window.Tototo.escapeHTML(card.id)}">Ver ficha</button>
            <button class="secondary-button" type="button" data-result-close>Cerrar</button>
        `;

        bindResultModalActions(body);
        window.Tototo.openModal("pack-result-modal");
    }

    function registerOpeningHistory(pack, summary, results, stopReasons, conFragmentos) {
        ensureShopState();
        const state = window.Tototo.getState();
        const notable = results
            .filter(result => !result.isDuplicate || ["SSR", "UR"].includes(result.prize.rareza))
            .slice(0, 12)
            .map(result => ({
                cardId: result.prize.id,
                rarity: result.prize.rareza,
                isDuplicate: result.isDuplicate
            }));

        const entry = {
            id: `opening_${Date.now()}_${Math.floor(Math.random() * 999999)}`,
            timestamp: Date.now(),
            packId: pack.id,
            packName: pack.nombre || pack.id,
            opened: summary.abiertos,
            newCards: summary.nuevos,
            duplicates: summary.duplicados,
            fragments: summary.fragmentosTotales,
            rarities: { ...summary.rarezas },
            source: conFragmentos ? "fragmentos" : "monedas",
            stoppedBy: [...stopReasons],
            notable,
            score: calculateOpeningScore(summary)
        };

        state.packHistory.unshift(entry);
        state.packHistory = state.packHistory.slice(0, MAX_HISTORY_ENTRIES);

        if (!state.bestOpening || entry.score > (Number(state.bestOpening.score) || 0)) {
            state.bestOpening = { ...entry };
        }

        return entry;
    }

    function calculateOpeningScore(summary) {
        return (summary.rarezas.UR || 0) * 100000
            + (summary.rarezas.SSR || 0) * 5000
            + (summary.rarezas.SR || 0) * 250
            + summary.nuevos * 50
            + summary.abiertos;
    }

    function renderHistory() {
        ensureShopState();
        const state = window.Tototo.getState();
        const bestContainer = document.getElementById("best-opening");
        const list = document.getElementById("opening-history-list");
        const clearButton = document.getElementById("clear-opening-history");
        if (!bestContainer || !list) return;

        bestContainer.classList.toggle("empty-state", !state.bestOpening);
        bestContainer.innerHTML = state.bestOpening
            ? renderHistoryEntry(state.bestOpening, { best: true })
            : "Todavía no hay aperturas registradas.";

        list.innerHTML = state.packHistory.length
            ? state.packHistory.map(entry => renderHistoryEntry(entry)).join("")
            : '<div class="empty-state">Abre sobres para crear tu historial.</div>';

        bindHistoryCards(bestContainer);
        bindHistoryCards(list);

        if (clearButton && !clearButton.dataset.boundClearHistory) {
            clearButton.dataset.boundClearHistory = "true";
            clearButton.addEventListener("click", () => {
                if (!window.Tototo.getState().packHistory.length && !window.Tototo.getState().bestOpening) return;
                if (!confirm("¿Borrar el historial y la mejor apertura registrada?")) return;
                window.Tototo.getState().packHistory = [];
                window.Tototo.getState().bestOpening = null;
                window.Tototo.save();
                renderHistory();
            });
        }
    }

    function renderHistoryEntry(entry, { best = false } = {}) {
        const date = formatHistoryDate(entry.timestamp);
        const stopped = entry.stoppedBy?.length ? ` · ⏹ ${entry.stoppedBy.join(" y ")}` : "";
        const notable = Array.isArray(entry.notable) ? entry.notable : [];

        return `
            <article class="history-entry ${best ? "best" : ""}">
                <div class="history-entry-main">
                    <div>
                        <strong>${best ? "🏆 Mejor apertura · " : ""}${window.Tototo.escapeHTML(entry.packName || entry.packId || "Sobre")}</strong>
                        <small>${window.Tototo.escapeHTML(date)} · ${window.Tototo.formatNumber(entry.opened || 0)} sobres · ${entry.source === "fragmentos" ? "fragmentos" : "monedas"}${window.Tototo.escapeHTML(stopped)}</small>
                    </div>
                    <div class="history-entry-stats">
                        <span class="success-text">${window.Tototo.formatNumber(entry.newCards || 0)} nuevos</span>
                        <span>SSR ${window.Tototo.formatNumber(entry.rarities?.SSR || 0)}</span>
                        <span class="rarity-UR">UR ${window.Tototo.formatNumber(entry.rarities?.UR || 0)}</span>
                    </div>
                </div>
                ${notable.length ? `
                    <div class="history-notable-list">
                        ${notable.map(item => {
                            const card = window.Tototo.getCards().find(candidate => candidate.id === item.cardId);
                            if (!card) return "";
                            return `<button type="button" data-history-card="${window.Tototo.escapeHTML(card.id)}" title="${window.Tototo.escapeHTML(card.nombre)}">
                                <img src="${window.Tototo.escapeHTML(card.imagen)}" alt="${window.Tototo.escapeHTML(card.nombre)}" loading="lazy">
                                <span>${window.Tototo.escapeHTML(card.rareza)}</span>
                            </button>`;
                        }).join("")}
                    </div>
                ` : ""}
            </article>
        `;
    }

    function bindHistoryCards(container) {
        container.querySelectorAll("[data-history-card]").forEach(button => {
            button.addEventListener("click", () => window.Encyclopedia?.openCard?.(button.dataset.historyCard));
        });
    }

    function formatHistoryDate(timestamp) {
        try {
            return new Intl.DateTimeFormat("es-ES", {
                dateStyle: "short",
                timeStyle: "short"
            }).format(new Date(timestamp));
        } catch (error) {
            return "Fecha desconocida";
        }
    }

    function getRarityChancesForDisplay() {
        const chances = getEffectiveRarityChances();
        return Object.fromEntries(
            Object.entries(chances).map(([rarity, value]) => [rarity, Math.round(value * 10000) / 100])
        );
    }

    return {
        render,
        buyPack: comprarSobre,
        getPackCost,
        getEffectiveRarityChances,
        getRarityChancesForDisplay,
        renderHistory,
        FRAGMENTOS_POR_SOBRE,
        DUPLICATE_FRAGMENT_VALUES,
        MAX_BATCH_OPEN
    };
})();
