import QRCode from 'qrcode';
import {PDFDocument,StandardFonts} from 'pdf-lib';
export const labelLayout={width:595.28,height:841.89,perPage:24,columns:3,qrSize:68};
const caption=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,c=>c==='đ'?'d':'D').replace(/[^\x20-\x7e]/g,'?').slice(0,22);
export async function createLabelsPdf(selected){
 if(!Array.isArray(selected)||!selected.length||selected.length>300)throw Error('Chọn 1–300 nhãn');
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 for(let i=0;i<selected.length;i++){
 const a=selected[i];if(!a?.barcode)throw Error('Nhãn thiếu barcode');
 if(i%24===0)pdf.addPage([labelLayout.width,labelLayout.height]);
 const page=pdf.getPages().at(-1),col=i%3,row=Math.floor((i%24)/3),x=28+col*181,y=810-row*98;
 const image=await pdf.embedPng(await QRCode.toDataURL(String(a.barcode),{errorCorrectionLevel:'M',margin:4,width:300}));
 page.drawImage(image,{x,y:y-70,width:68,height:68});
 page.drawText(caption(a.McSerialNumber),{x:x+72,y:y-25,size:8,font});
 page.drawText(caption(a.barcode),{x:x+72,y:y-40,size:7,font});
 }
 return pdf.save();
}
