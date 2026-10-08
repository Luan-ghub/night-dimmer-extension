# Night Dimmer

Extensão Chromium Manifest V3 com redução de brilho, filtro de conforto, perfil
automático e modo escuro inteligente. Os recursos podem ser aplicados em uma
aba, em abas selecionadas ou em todas as abas.

## Recursos

### Brilho da página

- Controle manual entre 10% e 100%.
- Atalhos para 25%, 50%, 70% e 100%.
- Perfil automático com porcentagem personalizada.
- Ao ativar o perfil, o valor salvo substitui temporariamente o ajuste manual.
- Ao desativar o perfil, o último ajuste manual volta a ser utilizado.

### Filtro conforto

Adiciona uma camada quente regulável, semelhante a filtros de leitura ou luz
noturna. O efeito não altera fisicamente a temperatura de cor do monitor.

### Modo escuro inteligente

Analisa as cores calculadas dos elementos da página e tenta:

- converter superfícies claras em superfícies escuras;
- clarear textos que perderiam contraste;
- adaptar bordas;
- preservar imagens, vídeos, canvas e SVG;
- acompanhar elementos adicionados dinamicamente;
- processar frames e Shadow DOM aberto quando acessíveis.

O recurso é reversível e oferece três intensidades: **Suave**, **Equilibrado** e
**Intenso**. Sites muito complexos podem exigir correções específicas; por isso,
o recurso está marcado como experimental.

### Aplicação por abas

- **Somente nesta aba:** aplica na aba ativa no momento da configuração.
- **Abas selecionadas:** mostra as guias da janela atual com favicon, título,
  domínio e último acesso.
- **Todas as abas:** aplica em abas compatíveis de todas as janelas.

A lista de abas pode ser expandida verticalmente arrastando sua borda inferior.

## Privacidade e permissões

As configurações são armazenadas localmente pelo navegador. A extensão não envia
dados para serviços externos e não coleta o histórico de navegação.

- `storage`: salva as preferências de brilho e conforto visual;
- `tabs`: permite selecionar em quais abas os efeitos serão aplicados;
- `scripting` e acesso às páginas: aplicam os efeitos nas abas escolhidas.

## Como instalar

1. Desative as versões anteriores do Night Dimmer para evitar efeitos somados.
2. No GitHub, selecione **Code > Download ZIP** e extraia o arquivo.
3. Confirme que `manifest.json` está diretamente dentro da pasta extraída.
4. Abra `brave://extensions`.
5. Ative o **Modo do desenvolvedor**.
6. Clique em **Carregar sem compactação**.
7. Selecione a pasta que contém o `manifest.json`.

No Chrome, use `chrome://extensions`. No Edge, use `edge://extensions`.

## Teste sugerido

1. Abra alguns sites comuns em abas diferentes.
2. Ajuste o brilho ou use um dos quatro atalhos.
3. Digite um valor em **Brilho salvo**, clique em **Salvar perfil** e ative o
   switch do perfil automático.
4. Ative o filtro conforto e regule sua intensidade.
5. Ative o modo escuro inteligente inicialmente no nível **Equilibrado**.
6. Teste os três escopos de aplicação.
7. Em **Abas selecionadas**, use os favicons e títulos para marcar as guias e
   experimente o redimensionamento vertical com o mouse.

## Limitações

O Brave e demais navegadores Chromium não permitem alterações em páginas
internas (`brave://...`, `chrome://...`, `edge://...`), lojas de extensões e
alguns visualizadores protegidos.

Sites podem usar estruturas gráficas, temas e estilos muito diferentes. O modo
escuro inteligente emprega heurísticas gerais e pode produzir resultados
imperfeitos em algumas páginas. Desative somente esse recurso quando necessário;
o brilho e o filtro conforto continuarão disponíveis.

## Estrutura do projeto

```text
night-dimmer/
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.css
├── popup.js
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── .github/
├── LICENSE
└── README.md
```

## Apoie o projeto

Se o Night Dimmer for útil para você, considere apoiar o projeto:

<a href="https://buymeacoffee.com/luan_grm">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Apoie no Buy Me a Coffee" width="217">
</a>

## Licença

O projeto é disponibilizado sob a [licença MIT](LICENSE).
