# 🎭 Planejamento: Sistema de Troca de Rosto (Face Switcher)

> **Objetivo:** Permitir trocar entre o rosto V1 (SVG inline) e o rosto V2 (HTML/CSS com iframes) via Settings, sem perder nenhuma funcionalidade existente.

---

## 📊 Análise da Situação Atual

### Rosto V1 (atual — SVG inline no `index.html`)
- **Tipo:** SVG inline com manipulação DOM direta
- **Expressões:** happy, talking, thinking, sleeping, working, angry, surprised, listening
- **Função de controle:** `setExpression(expr)` em `index.html` — manipula paths, círculos, opacidades, animações CSS
- **Extras:** Cabelo PNG overlay (`docs/cabelo.png`), antena tech com cores por expressão, blush, blink
- **Tamanho:** ~600 linhas de SVG + ~400 linhas de JS de expressões dentro do `index.html`

### Rosto V2 (novo — HTMLs separados em `v2rosto/`)
- **Tipo:** HTMLs separados por expressão, carregados via iframe
- **Expressões:** standby, talking, listening, thinking, working, sleeping, angry (7 expressões)
- **Arquivos:** `standby.html`, `talking.html`, `listening.html`, `thinking.html`, `working.html`, `sleeping.html`, `angry.html`
- **Controle:** Troca de `iframe.src` para mudar expressão
- **Visual:** Rosto CSS puro (divs + border-radius + animations), estilo mais robótico/tech

### Mapeamento de Expressões V1 → V2

| V1 (atual) | V2 (novo) | Notas |
|------------|-----------|-------|
| happy | standby | Estado padrão |
| talking | talking | ✅ Idêntico |
| thinking | thinking | ✅ Idêntico |
| sleeping | sleeping | ✅ Idêntico |
| working | working | ✅ Idêntico |
| angry | angry | ✅ Idêntico |
| surprised | standby | V2 não tem surprised, usar standby |
| listening | listening | ✅ Idêntico |

---

## 🏗️ Etapas de Implementação

### Etapa A — Configuração e Settings
> **Complexidade:** Baixa | **Estimativa:** 15 min

**O que fazer:**
1. Adicionar campo `faceStyle` no `settings-manager.js` com valores: `"v1"` (padrão) ou `"v2"`
2. Adicionar selector no modal de Settings do `index.html` (dropdown: "Rosto Clássico (V1)" / "Rosto Tech (V2)")
3. Adicionar IPC para notificar mudança de rosto em runtime

**Critério de aceite:** Dropdown aparece no Settings, valor persiste em `settings.json`

---

### Etapa B — Reorganizar Arquivos do V2
> **Complexidade:** Baixa | **Estimativa:** 10 min

**O que fazer:**
1. Mover `v2rosto/*.html` para `faces/v2/` (exceto `index.html` que é o demo, e `TABBIE_ESP32_GUIDE.md`)
2. Criar pasta `faces/v2/` com: `standby.html`, `talking.html`, `listening.html`, `thinking.html`, `working.html`, `sleeping.html`, `angry.html`
3. Garantir que os HTMLs funcionam com paths relativos (são self-contained)
4. Atualizar `.gitignore` se necessário

**Critério de aceite:** `faces/v2/standby.html` abre corretamente no browser

---

### Etapa C — Criar Container de Rosto Dinâmico no `index.html`
> **Complexidade:** Média | **Estimativa:** 30 min

**O que fazer:**
1. Criar um container `#face-container` que pode conter:
   - **Modo V1:** O SVG inline atual (rosto clássico)
   - **Modo V2:** Um `<iframe>` que carrega os HTMLs de `faces/v2/`
2. Extrair o SVG do rosto V1 para uma div `#face-v1` dentro do container
3. Criar uma div `#face-v2` com um `<iframe>` escondido
4. Criar função `switchFaceStyle(style)` que:
   - Se `style === 'v1'`: mostra `#face-v1`, esconde `#face-v2`
   - Se `style === 'v2'`: esconde `#face-v1`, mostra `#face-v2`
5. Chamar `switchFaceStyle` no startup baseado no settings

**Critério de aceite:** Ambos os rostos renderizam corretamente no container

---

### Etapa D — Adaptar `setExpression()` para Multi-Face
> **Complexidade:** Média | **Estimativa:** 30 min

**O que fazer:**
1. Refatorar `setExpression(expr)` para ser um dispatcher:
   ```javascript
   function setExpression(expr) {
     currentExpression = expr;
     if (currentFaceStyle === 'v1') {
       setExpressionV1(expr);  // Lógica atual (SVG inline)
     } else {
       setExpressionV2(expr);  // Nova lógica (iframe)
     }
   }
   ```
2. Renomear a lógica atual de `setExpression` para `setExpressionV1(expr)`
3. Criar `setExpressionV2(expr)` que:
   - Mapeia nomes: `happy` → `standby`, `surprised` → `standby`, resto é 1:1
   - Troca `iframe.src` para o HTML correspondente em `faces/v2/`
   - Ex: `setExpressionV2('thinking')` → `iframe.src = 'faces/v2/thinking.html'`
4. Manter `currentExpression` para que todo o resto do sistema (agent, voice, etc.) continue funcionando sem mudanças

**Critério de aceite:** `setExpression('thinking')` funciona em ambos os modos, trocando a expressão correta

---

### Etapa E — Troca em Runtime (Hot Switch)
> **Complexidade:** Baixa | **Estimativa:** 15 min

**O que fazer:**
1. Quando o usuário muda o rosto no Settings e clica Salvar:
   - Chamar `switchFaceStyle(newStyle)` imediatamente
   - Restaurar a expressão atual no novo rosto
2. Garantir que a troca não perde estado (se estava thinking, o novo rosto mostra thinking)
3. Testar transição V1→V2 e V2→V1 sem recarregar a página

**Critério de aceite:** Trocar de rosto no Settings muda o rosto imediatamente sem reiniciar

---

### Etapa F — Ajustes de Layout e CSS
> **Complexidade:** Baixa | **Estimativa:** 20 min

**O que fazer:**
1. Garantir que o iframe do V2 tem o tamanho correto dentro do container do Buddy (320x420)
2. Ajustar background do V2 para combinar com o tema do Buddy (transparente ou `#0a0a0a`)
3. O V2 tem `background: #000` nos HTMLs — verificar se fica bom dentro do Buddy ou se precisa de `background: transparent`
4. Manter funcionalidade de clique no rosto (parar TTS) para ambos os modos
5. O V2 não tem cabelo/antena — está ok, é um estilo diferente

**Critério de aceite:** Ambos os rostos ficam bonitos e bem posicionados dentro da janela do Buddy

---

## 📋 Resumo das Etapas

| Etapa | O que | Complexidade | Estimativa |
|-------|-------|-------------|------------|
| **A** | Settings (`faceStyle` + dropdown) | Baixa | 15 min |
| **B** | Reorganizar arquivos V2 → `faces/v2/` | Baixa | 10 min |
| **C** | Container dinâmico no `index.html` | Média | 30 min |
| **D** | `setExpression()` multi-face (dispatcher) | Média | 30 min |
| **E** | Hot switch em runtime | Baixa | 15 min |
| **F** | Ajustes de layout/CSS | Baixa | 20 min |

**Total estimado: ~2 horas**

---

## 📂 Arquivos que serão criados/modificados

### Criados:
- `faces/v2/standby.html` (movido de v2rosto/)
- `faces/v2/talking.html` (movido de v2rosto/)
- `faces/v2/listening.html` (movido de v2rosto/)
- `faces/v2/thinking.html` (movido de v2rosto/)
- `faces/v2/working.html` (movido de v2rosto/)
- `faces/v2/sleeping.html` (movido de v2rosto/)
- `faces/v2/angry.html` (movido de v2rosto/)

### Modificados:
- `settings-manager.js` — novo campo `faceStyle`
- `index.html` — container dinâmico, `setExpressionV1/V2`, settings UI
- `preload.js` — IPC para trocar rosto (se necessário)
- `main.example.js` / `main.js` — IPC handler para face switch

---

## ⚠️ Regras Importantes

1. **NÃO apagar o rosto V1** — ele continua como padrão
2. **NÃO modificar os HTMLs do V2** — são usados como estão
3. **Manter compatibilidade** — todas as expressões existentes continuam funcionando
4. **`setExpression()` é a única API** — todo o sistema (agent, voice, scheduler) chama `setExpression(expr)`, o dispatcher decide se usa V1 ou V2
5. **Branch:** Criar `feature/face-switcher` a partir de `feature/agent-tool-registry`

---

## 🚀 Como Usar na Nova Sessão

Cole as instruções do projeto + adicione:
```
Leia o arquivo D:\sites\tabbie-desktop\PLAN-FACE-SWITCHER.md e implemente todas as etapas (A até F).
Siga o planejamento etapa por etapa, pedindo permissão antes de cada uma.
```

---

*Criado em: 19/03/2026*
