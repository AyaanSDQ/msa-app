// Icon sprite defs, ported 1:1 from design-reference/MSA Updates Mockups.dc.html
export const ICON_SPRITE = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-minaret" viewBox="0 0 24 24"><path d="M12 1.8v2.2"/><path d="M8.6 7.6a3.4 3.4 0 0 1 6.8 0"/><path d="M7.6 11.2h8.8"/><path d="M9.4 11.2V22"/><path d="M14.6 11.2V22"/><path d="M4.8 22h14.4"/></symbol>
<symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13A4 4 0 0 1 16 11"/></symbol>
<symbol id="i-mega" viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></symbol>
<symbol id="i-case" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></symbol>
<symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></symbol>
<symbol id="i-ban" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></symbol>
<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></symbol>
<symbol id="i-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="i-back" viewBox="0 0 24 24"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></symbol>
<symbol id="i-inbox" viewBox="0 0 24 24"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></symbol>
<symbol id="i-msg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></symbol>
<symbol id="banner-mosque" viewBox="0 0 400 132" preserveAspectRatio="xMidYMax slice"><g fill="currentColor" stroke="none"><path d="M0 122h400v10H0z"/><path d="M64 104h272v18H64z"/><path d="M162 122V86c0-20 14-32 38-46 24 14 38 26 38 46v36z"/><path d="M197 40V26h6v14z"/><circle cx="200" cy="21" r="5"/><path d="M128 122v-22c0-10 6-16 15-22 9 6 15 12 15 22v22z"/><path d="M242 122v-22c0-10 6-16 15-22 9 6 15 12 15 22v22z"/><path d="M92 122V62h18v60z"/><path d="M88 74h26v6H88z"/><path d="M92 62c0-10 4-16 9-22 5 6 9 12 9 22z"/><path d="M99 40V28h4v12z"/><path d="M290 122V62h18v60z"/><path d="M286 74h26v6h-26z"/><path d="M290 62c0-10 4-16 9-22 5 6 9 12 9 22z"/><path d="M297 40V28h4v12z"/><path d="M44 122V88h14v34z"/><path d="M44 88c0-8 3-13 7-18 4 5 7 10 7 18z"/><path d="M342 122V88h14v34z"/><path d="M342 88c0-8 3-13 7-18 4 5 7 10 7 18z"/></g></symbol>
<symbol id="banner-social" viewBox="0 0 400 132" preserveAspectRatio="xMidYMax slice"><g fill="currentColor" stroke="none">
<path d="M0 110h400v22H0z"/><ellipse cx="200" cy="112" rx="210" ry="9"/>
<g id="bs-half">
<path d="M34 112V44h9v68z"/><circle cx="38" cy="36" r="23"/><circle cx="16" cy="48" r="15"/><circle cx="60" cy="46" r="16"/><circle cx="38" cy="58" r="14"/>
<circle cx="86" cy="64" r="9"/><path d="M86 72c6 0 10 5 11 11l4 29H71l4-29c1-6 5-11 11-11z"/>
<circle cx="112" cy="58" r="10"/><path d="M112 67c7 0 11 5 12 12l4 33h-32l4-33c1-7 5-12 12-12z"/>
<circle cx="138" cy="54" r="10"/><path d="M128 112V76a10 10 0 0 1 20 0v36z"/><path d="M148 80h7v24h-7z"/>
</g>
<use href="#bs-half" transform="translate(400,0) scale(-1,1)"/>
<path d="M158 84h84v5h-84z"/><path d="M164 89h5v21h-5zM231 89h5v21h-5z"/><path d="M152 96h96v4h-96z"/>
<circle cx="178" cy="68" r="9"/><path d="M170 96V82a8 8 0 0 1 16 0v14z"/><path d="M170 96h16v12h-4v-6h-8v6h-4z"/>
<circle cx="222" cy="68" r="9"/><path d="M214 96V82a8 8 0 0 1 16 0v14z"/><path d="M214 96h16v12h-4v-6h-8v6h-4z"/>
<circle cx="200" cy="60" r="9"/><path d="M191 112V78a9 9 0 0 1 18 0v34z"/>
</g></symbol>
<symbol id="i-dot" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/></symbol>
</defs></svg>`;

export function icon(id, { size = 18, stroke = 2.5, filled = false } = {}) {
  const fillAttr = filled ? "currentColor" : "none";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fillAttr}" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"><use href="#${id}"></use></svg>`;
}
