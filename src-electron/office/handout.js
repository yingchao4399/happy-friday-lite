import AdmZip from 'adm-zip'
import sharp from 'sharp'

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

// 使用编辑器同一渲染器提供的页面位图，保留讲稿备注；无需系统 Word。
export async function buildSlidesHandout(pages) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 500) throw new Error('OFFICE_HANDOUT_PAGES_INVALID')
  const zip = new AdmZip()
  const relations = [], body = []
  for (const [index, page] of pages.entries()) {
    if (typeof page.pngBase64 !== 'string' || page.pngBase64.length > 32 * 1024 * 1024 || typeof page.notes !== 'string' || page.notes.length > 1024 * 1024) throw new Error('OFFICE_HANDOUT_PAGE_INVALID')
    const image = Buffer.from(page.pngBase64, 'base64')
    if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('OFFICE_HANDOUT_IMAGE_INVALID')
    const size = await sharp(image, { limitInputPixels: 64 * 1024 * 1024 }).metadata()
    if (!size.width || !size.height) throw new Error('OFFICE_HANDOUT_IMAGE_INVALID')
    const width = 5943600
    const height = Math.round(width * size.height / size.width)
    const id = `rId${index + 1}`
    zip.addFile(`word/media/slide-${index + 1}.png`, image)
    relations.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/slide-${index + 1}.png"/>`)
    if (index) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    body.push(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${index + 1}</w:t></w:r></w:p>`)
    body.push(`<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${index + 1}" name="Slide ${index + 1}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${index + 1}" name="slide-${index + 1}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`)
    for (const line of page.notes.split(/\r?\n/)) body.push(`<w:p><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`)
  }
  body.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1273" w:bottom="1080" w:left="1273"/></w:sectPr>')
  zip.addFile('[Content_Types].xml', Buffer.from(header + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'))
  zip.addFile('_rels/.rels', Buffer.from(header + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'))
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(header + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`))
  zip.addFile('word/document.xml', Buffer.from(header + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}</w:body></w:document>`))
  return zip.toBuffer()
}
