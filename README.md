# Log Analyzer

O Log Analyzer é uma plataforma avançada de análise de dados. A ferramenta permite processar, filtrar e analisar grandes volumes de logs e tabelas (CSV, XLSX, Parquet) diretamente no navegador, utilizando um backend Python otimizado para operações em memória.

![interface](print/interface.png)

## Arquitetura e Fluxo de Dados

A aplicação utiliza uma abordagem híbrida de alta performance e segurança:

1. **Ingestão:** Os arquivos são carregados via Drag & Drop ou seletor convencional.
2. **Otimização (Optimizing File Cache):** 
   - Arquivos CSV e Excel são convertidos instantaneamente para o formato **Parquet** via PyArrow.
   - O sistema realiza a otimização de memória automática, convertendo colunas de baixa cardinalidade em categorias.
3. **Persistência Local:** O arquivo convertido é armazenado no **IndexedDB** do navegador. Isso garante que, após o primeiro upload, o acesso aos dados seja imediato e offline (do ponto de vista de dados).
4. **Análise Stateless em RAM:** Para filtragens JQL, o servidor mantém os DataFrames **apenas em memória (RAM)**. Não há persistência em disco no servidor, garantindo velocidade absoluta e privacidade.

## Funcionalidades Detalhadas

### Processamento e Performance
- **Motor PyArrow:** Processamento ultrarrápido de arquivos colunares.
- **Memória Eficiente:** Otimização automática de colunas `object` para `category`, reduzindo o consumo de RAM em até 80%.
- **Excel Multitab:** Processamento coeso de arquivos com múltiplas abas em um único fluxo de importação.
- **Progress Tracking:** Barra de progresso em tempo real que reflete cada micro-etapa (Upload, Otimização e Interface).

### Interface e Experiência
- **Design Premium:** Interface Dark Mode com fidelidade visual, micro-animações e painéis retráteis.
- **Histórico Inteligente:** Sidebar com agrupamento de arquivos, suporte a renomeação (Tags) e exclusão em lote.
- **Timing Breakdown:** Ao passar o mouse sobre o tempo de processamento no histórico, um tooltip detalhado exibe o tempo exato gasto em cada etapa técnica.
- **Navegação Silenciosa:** Troca de páginas e filtros rápidos sem bloqueio de interface (Silent Fetching).

### Segurança Avançada
- **Sessões Efêmeras:** Limite estrito de **8 horas** por sessão.
- **Proteção Anti-Hijacking:** Cada sessão é vinculada à identidade do usuário (IP + User-Agent). O acesso é negado se houver tentativa de roubo de sessão.
- **Zero Disk Trace:** O servidor não grava caches em disco (nem em AWS, nem em Docker local), utilizando `/dev/shm` para arquivos temporários críticos.

---

## Estrutura de Infraestrutura

- **Docker:** Configuração otimizada para desenvolvimento com volumes montados (`hot-reload`) e produção com Gunicorn.
- **Terraform:** Infraestrutura AWS pronta para produção (VPC, ECS Fargate, ECR, Load Balancers).
- **Backend Remoto:** Gestão de estado isolada por ambiente (dev/prod) via S3.

### Configuração do Terraform

Para inicializar com backend isolado:
```bash
terraform init -backend-config=envs/dev/backend.tf
```

---

## Como Executar

### Localmente (Desenvolvimento)
1. Certifique-se de ter o Docker instalado.
2. Execute: `docker-compose up --build`
3. A aplicação estará disponível em: `http://localhost:5001`
   - *Nota: O código local está montado como volume. Alterações no Python ou HTML serão refletidas instantaneamente (hot-reload).*

### Produção (AWS)
A aplicação está preparada para rodar em clusters ECS operando em modo stateless total. Certifique-se de configurar a `SECRET_KEY` via variável de ambiente.

---

## Sintaxe de Consulta (JQL)

| Operador | Ação | Exemplo de Uso |
| :--- | :--- | :--- |
| = | Igualdade exata | status = "sucesso" |
| ~ | Busca parcial (Contém) | log_message ~ "timeout" |
| !~ | Exclusão parcial (Não contém) | level !~ "debug" |
| AND | Condição aditiva | status = "erro" AND user = "admin" |
| OR | Condição alternativa | code = 500 OR code = 503 |
| ( ) | Prioridade de lógica | status = "erro" AND (user = "a" OR user = "b") |

---
*Desenvolvido com foco em privacidade total, velocidade extrema e experiência de usuário premium.*
