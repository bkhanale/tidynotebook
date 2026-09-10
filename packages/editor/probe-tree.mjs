import { parser, GFM } from '@lezer/markdown';
const p = parser.configure([GFM]);
const doc = `# H1
## H2
###### H6

Setext H1
=========

Setext H2
---------

*em* **strong** ~~strike~~ \`code\` \\*escaped\\*

[label](https://example.com) <https://example.com> https://bare.example.com <a@b.com>

![alt](/attachments/abc123)
![ext](https://example.invalid/x.png)

> quote
> > nested

- a
  - b
    - c
1. one
5. five

- [ ] todo
- [x] done

\`\`\`js
const x = 1;
\`\`\`

    indented code

---
***

| a | b |
| :- | -: |
| 1 | 2 |

Text with a footnote[^n].

[^n]: The note.

Hard break line  
second

<div>html</div>

&amp; entity

$$x^2$$

$$
\\int_0^1
$$

\\(inline\\)
`;
const tree = p.parse(doc);
const seen = new Map();
tree.iterate({ enter: (n) => { const t = doc.slice(n.from, n.to).slice(0,40); if(!seen.has(n.name)) seen.set(n.name, t); } });
for (const [k,v] of seen) console.log(k, '::', JSON.stringify(v));
console.log('---- structure ----');
let depth=0;
tree.iterate({ enter: (n)=>{ console.log(' '.repeat(depth*2)+n.name+' ['+n.from+','+n.to+'] '+JSON.stringify(doc.slice(n.from,n.to).slice(0,30))); depth++; }, leave: ()=>{depth--;} });
