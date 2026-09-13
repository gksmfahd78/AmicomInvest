from pathlib import Path
import fitz,json,unicodedata
from pptx import Presentation
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[2];out=ROOT/'presentations/output';review=ROOT/'presentations/review'
pdf=fitz.open(out/'AMICOM_Investment_Course.pdf');prs=Presentation(out/'AMICOM_Investment_Course.pptx')
assert len(pdf)==len(prs.slides)
missing=[];outside=[]
for idx,(slide,page) in enumerate(zip(prs.slides,pdf)):
 expected=''.join(sh.text for sh in slide.shapes if sh.has_text_frame)
 actual=page.get_text()
 norm=lambda s:''.join(unicodedata.normalize('NFKC',s).split())
 an=norm(actual)
 for shape in slide.shapes:
  if shape.has_text_frame and norm(shape.text) not in an:missing.append({'page':idx+1,'text':shape.text})
 for block in page.get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   for span in line['spans']:
    r=fitz.Rect(span['bbox'])
    if r.x0<-.5 or r.y0<-.5 or r.x1>page.rect.width+.5 or r.y1>page.rect.height+.5:outside.append({'page':idx+1,'text':span['text']})
 # Verify editable content and lecturer notes on every slide.
 assert slide.notes_slide.notes_text_frame.text.strip(),idx+1
 assert sum(sh.has_text_frame for sh in slide.shapes)>=4,idx+1
 for shape in slide.shapes:
  if shape.has_text_frame:
   for pp in shape.text_frame.paragraphs:
    if len(pp.runs)>0:pass
font=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',17,index=1)
for batch in range((len(pdf)+11)//12):
 sheet=Image.new('RGB',(1440,900),'#ddd');dr=ImageDraw.Draw(sheet)
 for j in range(12):
  idx=batch*12+j
  if idx>=len(pdf):break
  pm=pdf[idx].get_pixmap(matrix=fitz.Matrix(.5,.5),alpha=False)
  im=Image.frombytes('RGB',(pm.width,pm.height),pm.samples)
  im.thumbnail((472,266));x=(j%3)*480;y=(j//3)*225
  # sheet has 4 rows, thumbnail resized to fit 480x210
  im.thumbnail((472,199));sheet.paste(im,(x+4,y+22));dr.text((x+6,y),f'{idx+1:02d}',fill='#222',font=font)
 sheet.save(review/f'contact-{batch+1:02d}.jpg',quality=88)
for index in [0,2,4,23,25,26,28,29,38,48,60,69,74,81,87]:
 pm=pdf[index].get_pixmap(matrix=fitz.Matrix(1.4,1.4),alpha=False);pm.save(review/f'slide-{index+1:02d}.png')
report={'pages':len(pdf),'missingText':missing,'outsideText':outside,'editableSlides':len(prs.slides),'notesSlides':len(prs.slides)}
(review/'render-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
