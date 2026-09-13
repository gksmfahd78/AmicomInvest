from pathlib import Path
import json, math, re
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR, MSO_AUTO_SIZE
from pptx.oxml.xmlchemy import OxmlElement
from PIL import ImageFont
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'presentations/output';OUT.mkdir(exist_ok=True)
DATA=json.loads((ROOT/'presentations/src/course-data.json').read_text())
FONT='Noto Sans CJK KR'
FONT_PATH='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
BOLD_PATH='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
C={'bg':'F7F5F0','ink':'19282C','muted':'5C6B6E','red':'CF283B','blue':'3667A1','green':'167964','line':'D8DEDA','soft':'E8EDE8','white':'FFFFFF','dark':'17292D','pale':'FBE9E7'}
W,H=13.333333,7.5
TRACK=[]
def rgb(c):return RGBColor.from_string(C.get(c,c))
def box(s,x,y,w,h,fill,line=None,round=False):
 q=s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if round else MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
 style=q._element.find('{http://schemas.openxmlformats.org/presentationml/2006/main}style')
 if style is not None:q._element.remove(style)
 q.fill.solid();q.fill.fore_color.rgb=rgb(fill)
 if line:q.line.color.rgb=rgb(line)
 else:q.line.fill.background()
 q._element.spPr.append(OxmlElement("a:effectLst"))
 if round:q.adjustments[0]=.12
 return q
def line(s,x,y,x2,y2,color='line',width=1.5):
 q=s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x), Inches(y), Inches(x2), Inches(y2));q.line.color.rgb=rgb(color);q.line.width=Pt(width)
 style=q._element.find('{http://schemas.openxmlformats.org/presentationml/2006/main}style')
 if style is not None:q._element.remove(style)
 q._element.spPr.append(OxmlElement('a:effectLst'))
 return q
def wrap(t,w,size,bold=False):
 f=ImageFont.truetype(BOLD_PATH if bold else FONT_PATH,round(size*2),index=1)
 maxw=w*144-4;out=[]
 for part in str(t).split('\n'):
  current=''
  for word in part.split(' '):
   candidate=(current+' '+word).strip()
   if f.getlength(candidate)<=maxw:current=candidate
   else:
    if current:out.append(current)
    current=word
    while f.getlength(current)>maxw:
     n=1
     while n<len(current) and f.getlength(current[:n+1])<=maxw:n+=1
     out.append(current[:n]);current=current[n:]
  out.append(current)
 return '\n'.join(out)
def text(s,t,x,y,w,h,size=22,color='ink',bold=False,align=None,fit=True):
 fs=size;wrapped=wrap(t,w,fs,bold)
 while len(wrapped.split('\n'))*fs/72*1.22>h and fs>min(size,18):
  fs-=.5;wrapped=wrap(t,w,fs,bold)
 needed=len(wrapped.split('\n'))*fs/72*1.22
 if needed>h+.035:raise ValueError(f'Text overflow: {t[:60]} needs {needed:.2f} in {h}')
 q=s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h));tf=q.text_frame;tf.clear();tf.word_wrap=False;tf.auto_size=MSO_AUTO_SIZE.NONE;tf.vertical_anchor=MSO_ANCHOR.TOP;tf._txBody.bodyPr.set("anchorCtr","0")
 tf.margin_left=tf.margin_right=tf.margin_top=tf.margin_bottom=0
 for i,st in enumerate(wrapped.split('\n')):
  p=tf.paragraphs[0] if i==0 else tf.add_paragraph();p.text=st;p.font.name=FONT;p.font.size=Pt(fs);p.font.bold=bold;p.font.color.rgb=rgb(color);p.space_after=Pt(0);p.space_before=Pt(0);p.line_spacing=1.16
  p.alignment=align if align is not None else PP_ALIGN.LEFT
  pp=p._p.get_or_add_pPr();default=pp.find('{http://schemas.openxmlformats.org/drawingml/2006/main}defRPr')
  if default is not None:
   ea=OxmlElement('a:ea');ea.set('typeface',FONT);default.append(ea)
  for r in p.runs:
   rp=r._r.get_or_add_rPr();ea=OxmlElement('a:ea');ea.set('typeface',FONT);rp.append(ea)
 TRACK.append({'slide':id(s),'text':t,'x':x,'y':y,'w':w,'h':h,'font':fs,'used_h':needed})
 return q

def setup():
 p=Presentation();p.slide_width=Inches(W);p.slide_height=Inches(H);p.core_properties.author='아미콤 투자 스터디';p.core_properties.subject='가상 기업 자료를 활용한 투자 입문 수업';return p

def base(p,week,title,sub='',kind='CONCEPT',take=''):
 s=p.slides.add_slide(p.slide_layouts[6]);s.background.fill.solid();s.background.fill.fore_color.rgb=rgb('bg')
 box(s,.62,.42,.27,.06,'red');text(s,f'WEEK {week:02d}  /  {kind}',1.02,.31,8,.3,11,'muted',True)
 for i in range(8):box(s,10.62+i*.24,.39,.13,.07,'red' if i+1==week else 'line')
 text(s,title,.65,.9,12,1.02,31,bold=True)
 if sub:text(s,sub,.67,1.98,12,.42,16,'muted')
 if take:box(s,.65,6.56,.05,.35,'red');text(s,take,.83,6.55,11.85,.47,16,'ink',True)
 line(s,.65,7.06,12.68,7.06)
 text(s,'AMICOM  /  투자 스터디',.65,7.17,4,.19,9,'muted')
 text(s,'수치·회사·계약은 학습용 가상 자료',5.02,7.17,6,.19,9,'muted')
 text(s,f'{len(p.slides):02d}',12.1,7.13,.58,.25,11,'muted',align=PP_ALIGN.RIGHT)
 return s

def notes(s,week,d):
 lesson=DATA['lessons'][str(week)]['lessons'][d.get('lesson',0)]
 ps=d.get('paragraphs',[0,1,2,3]);body='\n\n'.join(lesson['paragraphs'][i] for i in ps)
 n=f"[슬라이드 목적]\n{d.get('take',d.get('title','수업 시작'))}\n\n[권장 진행]\n{d.get('time','설명 4분 · 질문 2분')}\n\n[설명 원고]\n{body}\n\n[진행자 안내]\n{d.get('note','표의 단위와 가정을 먼저 읽고, 계산 결과를 제시하기 전에 참가자의 답을 받아 주세요.')}\n\n[확인 질문]\n{d.get('ask','어떤 수치는 확인한 사실이고, 어떤 결론에는 추가 자료가 필요한가요?')}\n\n[자료 기준]\n한빛식품 및 인용 형식의 계약·기사는 교육용 가상 자료입니다. 실제 종목 추천이나 실제 공시 인용이 아닙니다. 다른 예제는 별도의 가정이므로 조건을 먼저 확인합니다.\n\n[공식 개념 참고]\n"
 for k in DATA['weeks'][week-1]['sources']:n+=DATA['sources'][k]['title']+'\n'+DATA['sources'][k]['url']+'\n'
 s.notes_slide.notes_text_frame.text=n

def cards(s,items,y=2.72,h=3.27):
 n=len(items);gap=.22;cw=(12.02-(n-1)*gap)/n
 for i,it in enumerate(items):
  x=.65+i*(cw+gap);box(s,x,y,cw,h,'white',round=True)
  text(s,it[0],x+.24,y+.23,cw-.48,.38,15,'muted',True)
  text(s,it[1],x+.24,y+.91,cw-.48,1.1,34,it[3] if len(it)>3 else 'red',True)
  text(s,it[2],x+.24,y+2.14,cw-.48,.85,19)

def table(s,cols,rows,y=2.65,widths=None,highlight=None):
 widths=widths or [12.02/len(cols)]*len(cols)
 hh=.56;rh=min(.78,3.65/(len(rows)+.72));x=.65
 box(s,.65,y,12.02,hh,'ink')
 for c,w in zip(cols,widths):text(s,c,x+.16,y+.12,w-.32,.31,15,'white',True);x+=w
 for i,row in enumerate(rows):
  yy=y+hh+i*rh;x=.65
  box(s,.65,yy,12.02,rh,'pale' if i==highlight else ('white' if i%2==0 else 'soft'))
  for j,(cell,w) in enumerate(zip(row,widths)):
   text(s,cell,x+.16,yy+.14,w-.32,rh-.18,19,'red' if i==highlight else 'ink',j==0);x+=w

def flow(s,nodes):
 n=len(nodes);cw=(12.02-.42*(n-1))/n
 for i,(label,big,detail) in enumerate(nodes):
  x=.65+i*(cw+.42);text(s,f'0{i+1}',x,2.73,cw,.35,16,'red',True)
  line(s,x,3.2,x+cw,3.2,'line',2)
  text(s,label,x,3.47,cw,.54,20,'muted',True);text(s,big,x,4.19,cw,1.03,29,bold=True);text(s,detail,x,5.39,cw,.73,17,'muted')
  if i<n-1:text(s,'→',x+cw,4.3,.4,.6,25,'red')

def comparison(s,left,right):
 for i,item in enumerate([left,right]):
  x=.65+i*6.14;box(s,x,2.67,5.88,3.47,'white' if i==0 else 'ink',round=True)
  co='ink' if i==0 else 'white';text(s,item[0],x+.28,2.98,5.32,.4,16,'muted' if i==0 else 'E2ADAF',True)
  text(s,item[1],x+.28,3.65,5.3,1.15,29,co,True)
  text(s,item[2],x+.28,5.07,5.3,.85,19,co)

def timeline(s,events):
 n=len(events);span=11.18/(n-1);line(s,1.02,3.61,12.2,3.61,'line',3)
 for i,e in enumerate(events):
  x=1.02+i*span;box(s,x-.07,3.54,.14,.14,'red' if i==n-1 else 'ink')
  start=max(.65,min(x-.8,10.1));text(s,e[0],start,2.77,2.3,.6,26,'red' if i==n-1 else 'ink',True)
  text(s,e[1],start,4.0,2.3,.91,21,bold=True);text(s,e[2],start,5.15,2.3,.79,16,'muted')

def waterfall(s,labels,values,total_label='합계',unit='억 원'):
 # First bar is initial total; intermediate deltas, final total is calculated.
 vals=values+[sum(values)];labs=labels+[total_label];n=len(vals);cw=10.9/n;levels=[values[0]];cur=values[0]
 for v in values[1:]:cur+=v;levels.append(cur)
 maxv=max([0]+levels+[values[0]])*1.3;minv=min([0]+levels)*1.2
 scale=2.35/(maxv-minv or 1);zero=5.67+minv*scale
 line(s,.85,zero,12.5,zero,'line')
 cur=0
 for i,(lab,v) in enumerate(zip(labs,vals)):
  x=1+i*cw;is_total=i in (0,n-1)
  start=0 if is_total else cur;end=v if is_total else cur+v
  yy=zero-max(start,end)*scale;hh=max(abs(end-start)*scale,.04)
  color='ink' if is_total else ('green' if v>=0 else 'blue')
  box(s,x,yy,cw*.62,hh,color)
  text(s,f'{v:+g}' if not is_total else f'{v:g}',x-.1,yy-.49,cw*.82,.45,24,color,True,PP_ALIGN.CENTER)
  text(s,lab,x-.19,5.94,cw*.95,.49,15,'ink',True,PP_ALIGN.CENTER)
  if i<n-2:line(s,x+cw*.62,zero-end*scale,x+cw,zero-end*scale,'line',1)
  cur=end
 text(s,f'단위: {unit}',.7,2.65,4,.35,13,'muted')

def stacked(s,rows,segments):
 # rows: (label, values, labels). Scale widths in 100 percentage point units.
 colors=['blue','muted','red']
 for r,(label,values,labels) in enumerate(rows):
  yy=3.13+r*1.38;text(s,label,.72,yy+.19,1.36,.6,23,bold=True);xx=2.23
  for i,(v,lab) in enumerate(zip(values,labels)):
   ww=9.9*v/100;box(s,xx,yy,ww,.83,colors[i]);text(s,lab,xx+.08,yy+.24,ww-.16,.4,18,'white',True,PP_ALIGN.CENTER);xx+=ww
 for i,label in enumerate(segments):box(s,2.23+i*3.3,5.93,.16,.16,colors[i]);text(s,label,2.5+i*3.3,5.87,2.94,.39,16,'muted')

def exercise(s,d):
 box(s,.65,2.7,12.02,3.42,'ink',round=True)
 text(s,d['question'],.96,3.06,11.35,1.09,28,'white',True)
 for i,prompt in enumerate(d['prompts']):
  text(s,f'{i+1:02d}',.98,4.48+i*.44,.43,.36,16,'F3ACAA',True)
  text(s,prompt,1.6,4.47+i*.44,10.65,.38,18,'white')

def linechart(s):
 vals=[100,120,90,110];xs=[1.55,4.65,7.75,10.85]
 def yy(v):return 5.67-(v-80)/50*2.7
 for v in [80,100,120]:line(s,1.15,yy(v),12.15,yy(v),'line');text(s,str(v),.66,yy(v)-.14,.47,.32,12,'muted')
 for i in range(3):line(s,xs[i],yy(vals[i]),xs[i+1],yy(vals[i+1]),'red' if i!=1 else 'blue',4)
 for x,v in zip(xs,vals):box(s,x-.055,yy(v)-.055,.11,.11,'ink');text(s,str(v),x-.34,yy(v)-.5,.72,.4,22,bold=True,align=PP_ALIGN.CENTER)
 text(s,'고점 대비 −25%',6.0,2.71,3.2,.54,25,'blue',True);text(s,'시작 대비 +10%',9.02,5.97,3.3,.37,17,'red',True)

def render(p,w,d):
 s=base(p,w,d['title'],d.get('sub',''),d.get('kind','CONCEPT'),d.get('take',''));typ=d['type']
 if typ=='cards':cards(s,d['items'])
 elif typ=='table':table(s,d['cols'],d['rows'],widths=d.get('widths'),highlight=d.get('highlight'))
 elif typ=='flow':flow(s,d['nodes'])
 elif typ=='compare':comparison(s,d['left'],d['right'])
 elif typ=='timeline':timeline(s,d['events'])
 elif typ=='waterfall':waterfall(s,d['labels'],d['values'],d.get('total','합계'),d.get('unit','억 원'))
 elif typ=='stacked':stacked(s,d['rows'],d['segments'])
 elif typ=='exercise':exercise(s,d)
 elif typ=='line':linechart(s)
 elif typ=='quote':
  box(s,.65,2.73,.08,3.2,'red');text(s,d['quote'],1.04,2.92,11.18,1.98,29,bold=True);text(s,d.get('detail',''),1.05,5.19,11.12,.8,19,'muted')
 else:raise ValueError(typ)
 notes(s,w,d);return s

def cover(p,w,title,subtitle):
 s=p.slides.add_slide(p.slide_layouts[6]);s.background.fill.solid();s.background.fill.fore_color.rgb=rgb('dark')
 text(s,'AMICOM  /  INVESTMENT STUDIO',.73,.58,10,.42,14,'white',True)
 box(s,.75,1.42,.6,.065,'red');text(s,f'{w:02d}',9.27,1.68,3.6,2.8,154,'31474A',True)
 text(s,title,.73,2.02,8.95,1.95,42,'white',True)
 text(s,subtitle,.78,4.37,8.95,1.11,23,'D4DEDA')
 for i,(yy,hh) in enumerate([(4.6,.44),(4.08,.96),(3.48,1.56)]):box(s,10.06+i*.63,yy,.29,hh,'red' if i==2 else '687F7D')
 line(s,.77,6.42,12.54,6.42,'687F7D')
 text(s,f'WEEK {w:02d}  ·  투자 입문 스터디',.78,6.71,7,.43,17,'white');text(s,'개념 → 자료 → 계산 → 해석',8.45,6.72,4.1,.43,15,'D4DEDA',align=PP_ALIGN.RIGHT)
 notes(s,w,{'note':'이 주차의 핵심 질문을 먼저 읽고 참가자의 예상 답을 두 개 받아 기록합니다. 수익률 순위를 학습 평가 기준으로 쓰지 않습니다.','time':'도입 5분','take':subtitle})
 return s

def sources(p,w):
 s=base(p,w,'수업 자료와 다음 확인 항목','가상 사례의 계산과 실제 원문 조사를 구분합니다.','REFERENCE')
 y=2.63
 for k in DATA['weeks'][w-1]['sources']:
  it=DATA['sources'][k];text(s,it['title'],.78,y,11.8,.43,19,bold=True)
  link=text(s,it['url'],.78,y+.47,11.8,.42,11,'muted')
  for pp in link.text_frame.paragraphs:
   for run in pp.runs:run.hyperlink.address=it['url']
  y+=1.04
 text(s,'한빛식품·계약 문장·거래 기록은 교육을 위해 만든 가상 자료입니다.',.8,6.21,11.75,.45,16,'muted')
 s.notes_slide.notes_text_frame.text='가상 회사의 수치를 실제 기업의 자료로 인용하지 않습니다. 실제 조사는 원문 링크, 대상 기간, 단위, 연결 범위, 확인 날짜를 기록합니다.\n\n'+DATA['weeks'][w-1]['homework']
 return s

if __name__=='__main__':
 from deck_content import DECKS,COVERS
 combined=setup();manifest=[]
 for w,slides in DECKS.items():
  p=setup();title,subtitle=COVERS[w]
  for target in [p,combined]:
   cover(target,w,title,subtitle)
   for d in slides:render(target,w,d)
   sources(target,w)
  p.core_properties.title=f'아미콤 투자 스터디 {w}주차 · {DATA["weeks"][w-1]["title"]}'
  dest=OUT/f'AMICOM_Week_{w:02d}.pptx';p.save(dest)
  manifest.append({'week':w,'title':DATA['weeks'][w-1]['title'],'slides':len(p.slides),'file':dest.name})
 combined.core_properties.title='아미콤 투자 스터디 · 8주 강의';combined.save(OUT/'AMICOM_Investment_Course.pptx')
 (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
 # Check coordinates and text separation; intentional background/text overlaps are not tracked.
 issues=[]
 for t in TRACK:
  if min(t['x'],t['y'])<0 or t['x']+t['w']>W+.01 or t['y']+t['h']>H+.01:issues.append(t)
 assert not issues,issues
 (ROOT/'presentations/review/text-layout.json').write_text(json.dumps(TRACK,ensure_ascii=False,indent=2))
 print(json.dumps({'decks':len(manifest),'combinedSlides':len(combined.slides),'textBoxesChecked':len(TRACK),'outOfBounds':len(issues)},ensure_ascii=False))
