// Generación de reportes Excel (.xlsx) "profesionales" para los listados de
// Empresas y Contactos — con logo de BePharma, evento activo y resumen de
// filtros aplicados en la vista, para reemplazar el export CSV plano.
//
// Se centraliza acá (en vez de duplicar en server.js) porque el layout
// (logo + título + meta + tabla con zebra) es idéntico entre Empresas y
// Contactos; solo cambian las columnas y las filas.

const path = require('path')
const fs = require('fs')
const ExcelJS = require('exceljs')

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png')

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0052CC' } }
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 }
const ZEBRA_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F5F7' } }

// Convierte un índice de columna 1-based a letra de Excel (1 → A, 27 → AA…)
function colLetter(n) {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// columns: [{ header, key, width }]
// rows: [{ [key]: value }]
async function buildReportWorkbook({ sheetName, title, eventoActivo, filtroResumen, generadoPor, columns, rows }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'BePharma CRM'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 6 }],
  })

  const lastCol = colLetter(Math.max(columns.length, 3))

  // Logo — no debe romper la exportación si el archivo no está presente
  if (fs.existsSync(LOGO_PATH)) {
    try {
      const logoId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' })
      sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 78, height: 91 } })
    } catch { /* logo opcional, seguir sin el */ }
  }

  sheet.mergeCells(`C1:${lastCol}1`)
  sheet.getCell('C1').value = title
  sheet.getCell('C1').font = { bold: true, size: 14, color: { argb: 'FF172B4D' } }

  sheet.mergeCells(`C2:${lastCol}2`)
  sheet.getCell('C2').value = `Evento BePharma: ${eventoActivo}`
  sheet.getCell('C2').font = { bold: true, size: 11, color: { argb: 'FF0052CC' } }

  sheet.mergeCells(`C3:${lastCol}3`)
  const generadoLine = `Generado: ${new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}`
    + (generadoPor ? ` · por ${generadoPor}` : '')
  sheet.getCell('C3').value = generadoLine
  sheet.getCell('C3').font = { size: 10, color: { argb: 'FF6B778C' } }

  sheet.mergeCells(`C4:${lastCol}4`)
  sheet.getCell('C4').value = `Filtros aplicados: ${filtroResumen || 'Sin filtros (vista completa)'}`
  sheet.getCell('C4').font = { italic: true, size: 10, color: { argb: 'FF6B778C' } }
  sheet.getCell('C4').alignment = { wrapText: true, vertical: 'middle' }

  sheet.getRow(1).height = 26
  sheet.getRow(2).height = 18
  sheet.getRow(3).height = 16
  sheet.getRow(4).height = 28
  sheet.getRow(5).height = 6

  // Encabezado de la tabla (fila 6)
  const headerRow = sheet.getRow(6)
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = col.header
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  })
  headerRow.height = 20
  headerRow.commit()

  columns.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width || 18
  })

  rows.forEach(rowData => {
    const values = columns.map(col => rowData[col.key] ?? '')
    sheet.addRow(values)
  })

  // Zebra striping en las filas de datos
  for (let r = 7; r <= 6 + rows.length; r++) {
    if ((r - 7) % 2 === 1) {
      sheet.getRow(r).eachCell({ includeEmpty: true }, cell => { cell.fill = ZEBRA_FILL })
    }
  }

  // Fila de total al final
  const totalRow = sheet.addRow([`Total: ${rows.length} registro${rows.length === 1 ? '' : 's'}`])
  totalRow.getCell(1).font = { bold: true, italic: true, size: 10, color: { argb: 'FF6B778C' } }

  return workbook
}

// Reporte con VARIAS tablas apiladas en una sola hoja (no varias pestañas —
// mismo criterio que buildReportWorkbook: un solo .xlsx por reporte). Usado
// por los reportes de Actividad y BePharma, que muestran varias tablas
// pequeñas (resumen por operador, distribución por estado, etc.) en una
// misma vista. Mismo encabezado (logo + título + evento + generado + filtros)
// que buildReportWorkbook, pero el cuerpo son N secciones en vez de una tabla.
//
// sections: [{ heading, columns: [{header,key,width}], rows: [{...}] }]
async function buildMultiSectionWorkbook({ sheetName, title, eventoActivo, filtroResumen, generadoPor, sections }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'BePharma CRM'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(sheetName.slice(0, 31))
  const maxCols = Math.max(3, ...sections.map(s => s.columns.length))
  const lastCol = colLetter(maxCols)

  if (fs.existsSync(LOGO_PATH)) {
    try {
      const logoId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' })
      sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 78, height: 91 } })
    } catch { /* logo opcional, seguir sin el */ }
  }

  sheet.mergeCells(`C1:${lastCol}1`)
  sheet.getCell('C1').value = title
  sheet.getCell('C1').font = { bold: true, size: 14, color: { argb: 'FF172B4D' } }
  sheet.getRow(1).height = 26

  sheet.mergeCells(`C2:${lastCol}2`)
  sheet.getCell('C2').value = `Evento BePharma: ${eventoActivo}`
  sheet.getCell('C2').font = { bold: true, size: 11, color: { argb: 'FF0052CC' } }
  sheet.getRow(2).height = 18

  sheet.mergeCells(`C3:${lastCol}3`)
  const generadoLine = `Generado: ${new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}`
    + (generadoPor ? ` · por ${generadoPor}` : '')
  sheet.getCell('C3').value = generadoLine
  sheet.getCell('C3').font = { size: 10, color: { argb: 'FF6B778C' } }
  sheet.getRow(3).height = 16

  sheet.mergeCells(`C4:${lastCol}4`)
  sheet.getCell('C4').value = `Filtros aplicados: ${filtroResumen || 'Sin filtros (vista completa)'}`
  sheet.getCell('C4').font = { italic: true, size: 10, color: { argb: 'FF6B778C' } }
  sheet.getCell('C4').alignment = { wrapText: true, vertical: 'middle' }
  sheet.getRow(4).height = 28

  sheet.addRow([]) // fila 5 — separador bajo el encabezado

  sections.forEach((section, sIdx) => {
    if (sIdx > 0) sheet.addRow([]) // separador entre secciones

    const headingRow = sheet.addRow([section.heading])
    sheet.mergeCells(`A${headingRow.number}:${lastCol}${headingRow.number}`)
    headingRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF172B4D' } }
    headingRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9F2FF' } }
    headingRow.height = 20

    const headerRow = sheet.addRow(section.columns.map(c => c.header))
    headerRow.eachCell((cell, colNumber) => {
      if (colNumber > section.columns.length) return
      cell.fill = HEADER_FILL
      cell.font = HEADER_FONT
    })
    headerRow.height = 18

    if (!section.rows.length) {
      const emptyRow = sheet.addRow(['(sin datos)'])
      emptyRow.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF6B778C' } }
      return
    }

    const dataStartRow = headerRow.number + 1
    section.rows.forEach(rowData => {
      const values = section.columns.map(col => rowData[col.key] ?? '')
      sheet.addRow(values)
    })
    const dataEndRow = headerRow.number + section.rows.length
    for (let r = dataStartRow; r <= dataEndRow; r++) {
      if ((r - dataStartRow) % 2 === 1) {
        sheet.getRow(r).eachCell({ includeEmpty: true }, cell => { cell.fill = ZEBRA_FILL })
      }
    }
  })

  // Anchos de columna — el más ancho definido para cada índice entre secciones
  const widths = []
  sections.forEach(s => s.columns.forEach((c, i) => {
    widths[i] = Math.max(widths[i] || 12, c.width || 18)
  }))
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w })

  return workbook
}

// Agrega UNA hoja de datos crudos a un workbook ya existente — usado por
// buildBackupWorkbook para meter una pestaña por tipo de dato (Empresas,
// Contactos, Deals, Usuarios…) en vez de una sola tabla o secciones apiladas.
// Mismo encabezado visual (logo + título + generado) que el resto de
// reportes, pero sin "evento activo" ni "filtros" — un backup no está
// scopeado a un evento ni a una vista filtrada, es todo el dato.
function addDataSheet(workbook, { sheetName, generadoPor, generatedAt, columns, rows }) {
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 5 }],
  })
  const lastCol = colLetter(Math.max(columns.length, 3))

  if (fs.existsSync(LOGO_PATH)) {
    try {
      const logoId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' })
      sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 78, height: 91 } })
    } catch { /* logo opcional, seguir sin el */ }
  }

  sheet.mergeCells(`C1:${lastCol}1`)
  sheet.getCell('C1').value = `BePharma CRM — Copia de seguridad: ${sheetName}`
  sheet.getCell('C1').font = { bold: true, size: 14, color: { argb: 'FF172B4D' } }

  sheet.mergeCells(`C2:${lastCol}2`)
  const generadoLine = `Generado: ${new Date(generatedAt || Date.now()).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}`
    + (generadoPor ? ` · por ${generadoPor}` : '')
  sheet.getCell('C2').value = generadoLine
  sheet.getCell('C2').font = { size: 10, color: { argb: 'FF6B778C' } }

  sheet.getRow(1).height = 26
  sheet.getRow(2).height = 18
  sheet.getRow(3).height = 6

  const headerRow = sheet.getRow(5)
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = col.header
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  })
  headerRow.height = 20
  headerRow.commit()

  columns.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width || 18
  })

  rows.forEach(rowData => {
    const values = columns.map(col => rowData[col.key] ?? '')
    sheet.addRow(values)
  })

  for (let r = 6; r <= 5 + rows.length; r++) {
    if ((r - 6) % 2 === 1) {
      sheet.getRow(r).eachCell({ includeEmpty: true }, cell => { cell.fill = ZEBRA_FILL })
    }
  }

  const totalRow = sheet.addRow([`Total: ${rows.length} registro${rows.length === 1 ? '' : 's'}`])
  totalRow.getCell(1).font = { bold: true, italic: true, size: 10, color: { argb: 'FF6B778C' } }

  return sheet
}

// Copia de seguridad completa — un workbook con una hoja por tipo de dato.
// sheets: [{ sheetName, columns: [{header,key,width}], rows: [{...}] }]
async function buildBackupWorkbook({ generadoPor, generatedAt, sheets }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'BePharma CRM'
  workbook.created = new Date()

  sheets.forEach(s => addDataSheet(workbook, { ...s, generadoPor, generatedAt }))

  return workbook
}

async function workbookToBuffer(workbook) {
  return workbook.xlsx.writeBuffer()
}

module.exports = { buildReportWorkbook, buildMultiSectionWorkbook, buildBackupWorkbook, workbookToBuffer }
