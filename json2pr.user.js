// ==UserScript==
// @name         Bulk Add Indirect Requisition Lines from Clipboard
// @namespace    http://tampermonkey.net/
// @version      1.12
// @description  Speed optimized, no popups, visual button feedback.
// @match        *://*.lightning.force.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function queryDeep(selector, root = document) {
        let el = root.querySelector(selector);
        if (el) return el;
        const elements = root.querySelectorAll('*');
        for (let i = 0; i < elements.length; i++) {
            if (elements[i].shadowRoot) {
                let shadowEl = queryDeep(selector, elements[i].shadowRoot);
                if (shadowEl) return shadowEl;
            }
        }
        return null;
    }

    function queryDeepAll(selector, root = document) {
        let results = Array.from(root.querySelectorAll(selector));
        const elements = root.querySelectorAll('*');
        for (let el of elements) {
            if (el.shadowRoot) {
                results = results.concat(queryDeepAll(selector, el.shadowRoot));
            }
        }
        return results;
    }

    function setNativeValue(element, value) {
        if (!element) return;
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter?.call(element, value);
        } else {
            valueSetter?.call(element, value);
        }

        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    async function fillInlineEditCell(columnKey, value, isLookup = false) {
        const cells = queryDeepAll(`td[data-col-key-value*="${columnKey}"]`);
        if (!cells || cells.length === 0) return;

        const targetCell = cells[0];
        let inputEl = queryDeep('input', targetCell) || queryDeep('textarea', targetCell);

        if (!inputEl) {
            const editBtn = queryDeep('button[title="Edit"]', targetCell);
            if (editBtn) {
                editBtn.click();
                await sleep(100);
                inputEl = queryDeep('input', targetCell) || queryDeep('textarea', targetCell);
            }
        }

        if (inputEl) {
            inputEl.focus();
            setNativeValue(inputEl, value);

            if (isLookup) {
                await sleep(500);
                const listItem = queryDeep(`span[title="${value}"]`);
                if (listItem) {
                    listItem.click();
                } else {
                    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, composed: true }));
                    await sleep(100);
                    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
                }
            } else {
                await sleep(50);
                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
                inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
            }

            inputEl.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
            await sleep(100);
        }
    }

    async function processJSON(lineItems) {
        console.log("Starting bulk insert...", lineItems);

        for (let i = 0; i < lineItems.length; i++) {
            const item = lineItems[i];
            console.log(`Processing item ${i+1}:`, item.product_name);

            const addButton = queryDeep('button[title="Add"]');
            if (!addButton) {
                alert("Could not find the 'Add' button.");
                return;
            }
            addButton.click();

            await sleep(600);

            try {
                let cleanCost = item.cost ? item.cost.toString().replace(/[^0-9.]/g, '') : "0";
                let cleanQty = item.qty ? item.qty.toString() : "1";

                await fillInlineEditCell("rstk__syreqind_item__c", "Shop Supplies (General tools and supplies for the shop Ex: Screwdriver, sockets)", true);
                await fillInlineEditCell("Vendor_Item_Number__c", item.link, false);
                await fillInlineEditCell("Vendor_Item_Description__c", item.product_name, false);
                await fillInlineEditCell("rstk__syreqind_qtyreq__c", cleanQty, false);
                await fillInlineEditCell("rstk__syreqind_unitprice__c", cleanCost, false);

            } catch (err) {
                console.error(`Error processing row ${i+1}`, err);
            }
        }

        const saveButton = queryDeep('button[title="Save"]');
        if (saveButton) {
            console.log("Saving all rows...");
            saveButton.click();
            await sleep(3500);
        } else {
            console.warn("Could not find the Save button!");
        }

        console.log("Bulk insert complete.");
    }

    function injectButton() {
        if (document.getElementById('custom-bulk-add-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'custom-bulk-add-btn';
        btn.innerText = 'Bulk Add JSON from Clipboard';
        btn.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            z-index: 9999;
            padding: 8px 16px;
            background-color: #0176D3;
            color: white;
            border: none;
            border-radius: 4px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: background-color 0.3s;
        `;

        btn.addEventListener('click', async () => {
            try {
                const clipboardText = await navigator.clipboard.readText();
                if (!clipboardText || !clipboardText.trim()) return alert("Your clipboard is empty!");

                const parsedData = JSON.parse(clipboardText);
                if (!Array.isArray(parsedData)) return alert("Valid JSON detected, but it is not an Array.");

                // UX: Visual Loading State
                btn.innerText = 'Processing...';
                btn.style.opacity = '0.8';
                btn.disabled = true;

                // Execute logic
                await processJSON(parsedData);

                // UX: Visual Success State
                btn.innerText = 'Done';
                btn.style.backgroundColor = '#2e844a'; // Salesforce Success Green
                btn.style.opacity = '1';

                // Reset button after 5 seconds
                setTimeout(() => {
                    btn.innerText = 'Bulk Add JSON from Clipboard';
                    btn.style.backgroundColor = '#0176D3';
                    btn.disabled = false;
                }, 5000);

            } catch (error) {
                alert("🚨 INVALID JSON IN CLIPBOARD 🚨\n\n" + error.message);

                // Reset button immediately on failure
                btn.innerText = 'Bulk Add JSON from Clipboard';
                btn.style.opacity = '1';
                btn.disabled = false;
            }
        });

        document.body.appendChild(btn);
    }

    setTimeout(injectButton, 3000);

})();
