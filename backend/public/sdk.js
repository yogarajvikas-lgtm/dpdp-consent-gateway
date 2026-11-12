(function (window, document) {
  "use strict";

  const DEFAULT_API_BASE_URL = "http://localhost:8080/api/v1";

  const LABELS = {
    en: {
      notice: "NOTICE",
      purpose: "Purpose",
      categories: "Data Categories",
      required: "Required",
      notSpecified: "Not specified",
      manage: "You can manage your consent preferences from your account.",
      privacy: "Privacy Notice",
      grievance: "Grievance Contact",
      acceptAll: "Accept all",
      acceptSelected: "Accept selected",
      cancel: "Cancel",
      saving: "Saving your preference...",
      saved: "Your preference has been recorded.",
      close: "Close consent notice",
      powered: "Secured by DPDP Consent Gateway",
      defaultNotice: "Please review how your personal data is processed.",
    },
    kn: {
      notice: "ಗಮನಕ್ಕೆ",
      purpose: "ಉದ್ದೇಶ",
      categories: "ದತ್ತಾಂಶದ ವರ್ಗಗಳು",
      required: "ಅಗತ್ಯ",
      notSpecified: "ನಿರ್ದಿಷ್ಟಪಡಿಸಿಲ್ಲ",
      manage: "ನಿಮ್ಮ ಖಾತೆಯಿಂದ ನಿಮ್ಮ ಸಮ್ಮತಿ ಆದ್ಯತೆಗಳನ್ನು ನಿರ್ವಹಿಸಬಹುದು.",
      privacy: "ಗೌಪ್ಯತಾ ಸೂಚನೆ",
      grievance: "ಕುಂದುಕೊರತೆ ಸಂಪರ್ಕ",
      acceptAll: "ಎಲ್ಲವನ್ನೂ ಒಪ್ಪಿಕೊಳ್ಳಿ",
      acceptSelected: "ಆಯ್ದವುಗಳನ್ನು ಒಪ್ಪಿಕೊಳ್ಳಿ",
      cancel: "ರದ್ದುಮಾಡಿ",
      saving: "ನಿಮ್ಮ ಆದ್ಯತೆಯನ್ನು ಉಳಿಸಲಾಗುತ್ತಿದೆ...",
      saved: "ನಿಮ್ಮ ಆದ್ಯತೆಯನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ.",
      close: "ಸಮ್ಮತಿ ಸೂಚನೆಯನ್ನು ಮುಚ್ಚಿ",
      powered: "DPDP Consent Gateway ಮೂಲಕ ಸುರಕ್ಷಿತ",
      defaultNotice:
        "ನಿಮ್ಮ ವೈಯಕ್ತಿಕ ದತ್ತಾಂಶವನ್ನು ಹೇಗೆ ಸಂಸ್ಕರಿಸಲಾಗುತ್ತದೆ ಎಂಬುದನ್ನು ಪರಿಶೀಲಿಸಿ.",
    },
  };

  const DPDP = {
    config: null,
    purposes: [],
    noticeData: null,
    userId: null,

    init: function (config) {
      if (!config || !config.publicKey) {
        console.error("DPDP: Public API key is required.");
        return;
      }

      this.config = config;
      this.userId =
        config.userId || "DEMO_USER_" + Math.random().toString(36).slice(2, 10);

      this.showConsent(this.userId);
    },

    getApiBase: function () {
      return (this.config.apiBaseUrl || DEFAULT_API_BASE_URL).replace(
        /\/$/,
        "",
      );
    },

    getLanguage: function () {
      return (this.config.language || "en").toLowerCase() === "kn"
        ? "kn"
        : "en";
    },

    getLabels: function () {
      return LABELS[this.getLanguage()];
    },

    showConsent: async function (userId) {
      try {
        const response = await fetch(
          this.getApiBase() +
            "/consent/notice?lang=" +
            encodeURIComponent(this.getLanguage()),
          { headers: { "x-api-key": this.config.publicKey } },
        );

        if (!response.ok) {
          throw new Error(
            "Unable to load consent notice (HTTP " + response.status + ")",
          );
        }

        const data = await response.json();
        if (!Array.isArray(data.purposes) || !data.purposes.length) {
          throw new Error("No consent purposes available");
        }

        this.noticeData = data;
        this.purposes = data.purposes;
        this.renderPopup(userId);
      } catch (error) {
        console.error("DPDP SDK:", error.message);
      }
    },

    getPurposeName: function (purpose) {
      const language = this.getLanguage();
      const configured =
        this.config.purposeDetails &&
        this.config.purposeDetails[purpose.purpose_code];

      return (
        (language === "kn" && (purpose.purpose_name_kn || purpose.name_kn)) ||
        (language === "en" && (purpose.purpose_name_en || purpose.name_en)) ||
        (configured &&
          (language === "kn" ? configured.nameKn : configured.nameEn)) ||
        purpose.purpose_name ||
        purpose.display_name ||
        purpose.name ||
        String(purpose.purpose_code || "Consent purpose").replace(/_/g, " ")
      );
    },

    getDataCategories: function (purpose) {
      const configured =
        this.config.purposeDetails &&
        this.config.purposeDetails[purpose.purpose_code];
      const language = this.getLanguage();
      const categories =
        (configured &&
          (language === "kn"
            ? configured.categoriesKn
            : configured.categoriesEn)) ||
        purpose.data_categories ||
        purpose.notice_payload?.data_categories ||
        purpose.notice_payload?.dataCategories ||
        [];

      if (Array.isArray(categories)) {
        return categories
          .map(function (item) {
            if (typeof item === "string") return item;
            return item.name || item.category || item.label || "";
          })
          .filter(Boolean);
      }

      if (typeof categories === "string") {
        return categories
          .split(",")
          .map(function (item) {
            return item.trim();
          })
          .filter(Boolean);
      }

      return [];
    },

    getNoticeText: function () {
      const firstPurpose = this.purposes[0] || {};
      const payload = firstPurpose.notice_payload || {};
      const language = this.getLanguage();

      return (
        (language === "kn" && (payload.text_kn || payload.notice_text_kn)) ||
        (language === "en" && (payload.text_en || payload.notice_text_en)) ||
        payload.text ||
        payload.notice_text ||
        this.config.noticeText ||
        this.getLabels().defaultNotice
      );
    },

    renderPopup: function (userId) {
      const existing = document.getElementById("dpdp-consent-overlay");
      if (existing) existing.remove();

      const config = this.config;
      const labels = this.getLabels();
      const data = this.noticeData || {};
      const tenant = data.tenant || data;
      const primaryColor =
        config.theme?.primaryColor || tenant.primary_color || "#E67E22";
      const textColor =
        config.theme?.textColor || tenant.text_color || "#17365D";
      const companyName =
        config.companyName || tenant.company_name || "Privacy Preferences";
      const logoUrl = config.logoUrl || tenant.brand_logo_url || "";

      const overlay = document.createElement("div");
      overlay.id = "dpdp-consent-overlay";

      const style = document.createElement("style");
      style.textContent = `
        #dpdp-consent-overlay {
          position:fixed; inset:0; z-index:999999;
          background:rgba(15,23,42,.58); display:flex;
          align-items:center; justify-content:center; padding:16px;
          font-family:Arial,sans-serif; box-sizing:border-box;
        }
        #dpdp-consent-overlay * { box-sizing:border-box; }
        .dpdp-card {
          width:100%; max-width:620px; max-height:92vh; overflow-y:auto;
          background:#fff; border-radius:15px;
          box-shadow:0 20px 60px rgba(0,0,0,.25); color:${textColor};
        }
        .dpdp-header {
          display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
          align-items:center; gap:12px; padding:15px 20px;
          border-bottom:1px solid #edf0f4;
        }
        .dpdp-brand { display:flex; align-items:center; gap:9px; min-width:0; }
        .dpdp-logo {
          width:48px; height:48px; object-fit:contain; flex:0 0 48px;
          border-radius:50%; background:#fff;
        }
        .dpdp-brand-name { font-size:16px; font-weight:700; overflow-wrap:anywhere; }
        .dpdp-heading { font-size:18px; font-weight:700; letter-spacing:1px; text-align:center; }
        .dpdp-header-tools { display:flex; align-items:center; justify-content:flex-end; gap:9px; }
        .dpdp-language {
          border:1px solid #d7e0ec; background:#f5f8fc; color:${textColor};
          border-radius:7px; padding:7px 9px; cursor:pointer; font-size:12px;
          font-weight:700; white-space:nowrap;
        }
        .dpdp-close { border:0; background:transparent; color:#64748b;
          font-size:26px; cursor:pointer; line-height:1; padding:2px 4px; }
        .dpdp-content { padding:20px 22px; }
        .dpdp-notice { font-size:14px; line-height:1.7; margin-bottom:18px; color:#475569; }
        .dpdp-table { border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; }
        .dpdp-table-header,.dpdp-purpose-row {
          display:grid; grid-template-columns:34px minmax(115px,1fr) minmax(130px,1fr);
          align-items:center; gap:9px; padding:12px 11px;
        }
        .dpdp-table-header { background:#f5f7fa; font-size:13px; font-weight:700; }
        .dpdp-purpose-row { border-top:1px solid #edf0f4; font-size:13px; }
        .dpdp-checkbox { width:19px; height:19px; accent-color:${primaryColor}; cursor:pointer; }
        .dpdp-purpose-name { font-weight:600; overflow-wrap:anywhere; }
        .dpdp-required { display:inline-block; margin-top:5px; font-size:10px; color:#b45309; font-weight:600; }
        .dpdp-category-list { display:flex; flex-wrap:wrap; gap:5px; }
        .dpdp-category { background:#edf2f7; color:#475569; padding:5px 8px; border-radius:15px; font-size:11px; }
        .dpdp-help { margin-top:15px; color:#475569; font-size:12px; line-height:1.6; }
        .dpdp-help a { color:${primaryColor}; text-decoration:underline; }
        .dpdp-footer { padding:15px 22px; background:#f8fafc; border-top:1px solid #edf0f4; }
        .dpdp-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:9px; }
        .dpdp-btn { border:1px solid ${primaryColor}; border-radius:9px; padding:11px 16px;
          font-size:13px; font-weight:600; cursor:pointer; }
        .dpdp-accept-all { background:${primaryColor}; color:#fff; }
        .dpdp-selected { background:#fff; color:${primaryColor}; }
        .dpdp-cancel { background:#fff; color:#475569; border-color:#cbd5e1; }
        .dpdp-btn:disabled { opacity:.55; cursor:not-allowed; }
        .dpdp-status { min-height:18px; margin-top:10px; font-size:12px; color:#475569; }
        .dpdp-powered { margin-top:10px; text-align:center; font-size:10px; color:#94a3b8; }
        @media(max-width:520px) {
          .dpdp-card { max-height:95vh; }
          .dpdp-header { grid-template-columns:minmax(0,1fr) auto; padding:13px; }
          .dpdp-heading { grid-column:1; grid-row:2; text-align:left; font-size:14px; }
          .dpdp-header-tools { grid-column:2; grid-row:1 / span 2; }
          .dpdp-content,.dpdp-footer { padding:14px; }
          .dpdp-table-header,.dpdp-purpose-row {
            grid-template-columns:25px minmax(85px,1fr) minmax(90px,1fr);
            gap:6px; padding:9px 6px; font-size:11px;
          }
          .dpdp-category { font-size:10px; padding:4px 6px; }
          .dpdp-actions { flex-direction:column-reverse; }
          .dpdp-btn { width:100%; }
        }
      `;
      document.head.appendChild(style);

      const card = document.createElement("div");
      card.className = "dpdp-card";

      // Header: official tenant logo, notice title, language toggle and close.
      const header = document.createElement("div");
      header.className = "dpdp-header";

      const brand = document.createElement("div");
      brand.className = "dpdp-brand";

      if (logoUrl) {
        const logo = document.createElement("img");
        logo.className = "dpdp-logo";
        logo.src = logoUrl;
        logo.alt = companyName + " logo";
        brand.appendChild(logo);
      }

      const brandName = document.createElement("div");
      brandName.className = "dpdp-brand-name";
      brandName.textContent = companyName;
      brand.appendChild(brandName);

      const heading = document.createElement("div");
      heading.className = "dpdp-heading";
      heading.textContent = labels.notice;

      const tools = document.createElement("div");
      tools.className = "dpdp-header-tools";

      const languageButton = document.createElement("button");
      languageButton.type = "button";
      languageButton.className = "dpdp-language";
      languageButton.textContent =
        this.getLanguage() === "en" ? "ಕನ್ನಡ" : "English";
      languageButton.addEventListener("click", async () => {
        languageButton.disabled = true;
        this.config.language = this.getLanguage() === "en" ? "kn" : "en";
        await this.showConsent(userId);
      });

      const closeButton = document.createElement("button");
      closeButton.className = "dpdp-close";
      closeButton.type = "button";
      closeButton.textContent = "×";
      closeButton.setAttribute("aria-label", labels.close);
      closeButton.addEventListener("click", () => overlay.remove());

      tools.appendChild(languageButton);
      tools.appendChild(closeButton);
      header.appendChild(brand);
      header.appendChild(heading);
      header.appendChild(tools);

      const content = document.createElement("div");
      content.className = "dpdp-content";

      const notice = document.createElement("div");
      notice.className = "dpdp-notice";
      notice.textContent = this.getNoticeText();

      const table = document.createElement("div");
      table.className = "dpdp-table";

      const tableHeader = document.createElement("div");
      tableHeader.className = "dpdp-table-header";
      ["", labels.purpose, labels.categories].forEach(function (label) {
        const cell = document.createElement("div");
        cell.textContent = label;
        tableHeader.appendChild(cell);
      });
      table.appendChild(tableHeader);

      const checkboxes = [];

      this.purposes.forEach((purpose, index) => {
        const row = document.createElement("div");
        row.className = "dpdp-purpose-row";

        const checkboxCell = document.createElement("div");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "dpdp-checkbox";
        // Do not infer consent from a mandatory flag; the user must actively choose.
        checkbox.checked = false;
        checkbox.disabled = false;
        checkbox.dataset.index = index;
        checkboxCell.appendChild(checkbox);
        checkboxes.push(checkbox);

        const purposeCell = document.createElement("div");
        purposeCell.className = "dpdp-purpose-name";
        purposeCell.textContent = this.getPurposeName(purpose);

        if (purpose.is_mandatory) {
          const required = document.createElement("div");
          required.className = "dpdp-required";
          required.textContent = labels.required;
          purposeCell.appendChild(document.createElement("br"));
          purposeCell.appendChild(required);
        }

        const categoriesCell = document.createElement("div");
        categoriesCell.className = "dpdp-category-list";
        const categories = this.getDataCategories(purpose);

        if (categories.length) {
          categories.forEach(function (category) {
            const tag = document.createElement("span");
            tag.className = "dpdp-category";
            tag.textContent = category;
            categoriesCell.appendChild(tag);
          });
        } else {
          categoriesCell.textContent = labels.notSpecified;
        }

        row.appendChild(checkboxCell);
        row.appendChild(purposeCell);
        row.appendChild(categoriesCell);
        table.appendChild(row);
      });

      const help = document.createElement("div");
      help.className = "dpdp-help";
      help.textContent = config.manageText || labels.manage;

      if (config.privacyNoticeUrl) {
        help.appendChild(document.createElement("br"));
        const privacy = document.createElement("a");
        privacy.href = config.privacyNoticeUrl;
        privacy.target = "_blank";
        privacy.rel = "noopener noreferrer";
        privacy.textContent = labels.privacy;
        help.appendChild(privacy);
      }

      if (config.grievanceUrl) {
        help.appendChild(document.createTextNode(" · "));
        const grievance = document.createElement("a");
        grievance.href = config.grievanceUrl;
        grievance.target = "_blank";
        grievance.rel = "noopener noreferrer";
        grievance.textContent = labels.grievance;
        help.appendChild(grievance);
      }

      content.appendChild(notice);
      content.appendChild(table);
      content.appendChild(help);

      const footer = document.createElement("div");
      footer.className = "dpdp-footer";

      const actions = document.createElement("div");
      actions.className = "dpdp-actions";

      const status = document.createElement("div");
      status.className = "dpdp-status";
      status.setAttribute("role", "status");

      const cancelButton = document.createElement("button");
      cancelButton.className = "dpdp-btn dpdp-cancel";
      cancelButton.textContent = labels.cancel;
      cancelButton.addEventListener("click", () => overlay.remove());

      const selectedButton = document.createElement("button");
      selectedButton.className = "dpdp-btn dpdp-selected";
      selectedButton.textContent = labels.acceptSelected;

      const allButton = document.createElement("button");
      allButton.className = "dpdp-btn dpdp-accept-all";
      allButton.textContent = labels.acceptAll;

      const submitConsent = async (acceptAll) => {
        actions.querySelectorAll("button").forEach(function (button) {
          button.disabled = true;
        });
        status.textContent = labels.saving;

        const grantedPurposes = [];
        const deniedPurposes = [];

        this.purposes.forEach(function (purpose, index) {
          const selected = acceptAll || checkboxes[index].checked;
          (selected ? grantedPurposes : deniedPurposes).push(
            purpose.purpose_code,
          );
        });

        const versions = [
          ...new Set(
            this.purposes.map(function (purpose) {
              return purpose.version;
            }),
          ),
        ];

        if (versions.length > 1) {
          status.textContent =
            "Different notice versions require a backend API update.";
          actions.querySelectorAll("button").forEach(function (button) {
            button.disabled = false;
          });
          return;
        }

        const body = {
          userId: userId,
          grantedPurposes: grantedPurposes,
          deniedPurposes: deniedPurposes,
          noticeVersion: versions[0],
          clientFingerprint: {
            source: "website-sdk",
            userAgent: navigator.userAgent,
            language: navigator.language,
            screenResolution: window.screen.width + "x" + window.screen.height,
          },
        };

        try {
          const result = await fetch(this.getApiBase() + "/consent/grant", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": config.publicKey,
            },
            body: JSON.stringify(body),
          });

          const responseData = await result.json();
          if (!result.ok) {
            throw new Error(responseData.error || "Consent submission failed");
          }

          status.textContent = labels.saved;
          window.dispatchEvent(
            new CustomEvent("dpdp:consent-complete", {
              detail: responseData,
            }),
          );

          window.setTimeout(function () {
            overlay.remove();
            style.remove();
          }, 1400);
        } catch (error) {
          status.textContent = error.message;
          actions.querySelectorAll("button").forEach(function (button) {
            button.disabled = false;
          });
        }
      };

      allButton.addEventListener("click", function () {
        submitConsent(true);
      });
      selectedButton.addEventListener("click", function () {
        submitConsent(false);
      });

      actions.appendChild(cancelButton);
      actions.appendChild(selectedButton);
      actions.appendChild(allButton);

      const powered = document.createElement("div");
      powered.className = "dpdp-powered";
      powered.textContent = labels.powered;

      footer.appendChild(actions);
      footer.appendChild(status);
      footer.appendChild(powered);

      card.appendChild(header);
      card.appendChild(content);
      card.appendChild(footer);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    },
  };

  window.DPDP = DPDP;
})(window, document);
