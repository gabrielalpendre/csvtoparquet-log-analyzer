# Log Analyzer Pro

O **Log Analyzer Pro** é uma ferramenta de análise de dados ultra-rápida, privada e escalável, projetada para processar grandes volumes de logs e tabelas diretamente no seu navegador, com o poder do **Python (Flask)** e **Pandas** no backend.


![home](static/interface.png)

## Funcionalidades

- **Conversão Automática:** Transforma CSVs e XLSXs pesados em arquivos Parquet otimizados.
- **Upload ágil:** Realize upload de arquivos CSV, XLSX ou Parquet apenas arrastando o arquivo para a tela.
- **UI Responsiva:** Interface Dark Mode com painéis laterais retráteis e feedback visual de carregamento.
- **Query JQL (JSON Query Language):** Filtros avançados com suporte a operadores `=` (igual), `~` (contém),  `!~` (não contém), `AND` e `OR`.
- **Análise Quantitativa:** Contagem de valores e frequências com um clique no cabeçalho.
- **Visualização de Performance:** Contagem de tempo para a importação do arquivo e tempo da execução do filtro.
- **Persistência:** Histórico de arquivos carregados com opção de taguear com nomes e excluir.
- **Exportação:** Gere relatórios em Excel (.xlsx) baseados nos seus filtros atuais.
=======
Esta aplicação foi reconstruída para ser **Executada via containe (Cloud Ready)** e respeitar a **Privacidade do Usuário (Privacy by Design)**.
>>>>>>> bdf1c50 (feat: adicionando novas features ao README)

---

## Diferenciais

- ** Privacidade Total (IndexedDB):** Seus arquivos são armazenados localmente no banco de dados do seu navegador. O servidor é "stateless" (sem estado), ou de seja, seus dados nunca ficam salvos permanentemente em disco remoto.
- ** Performance de Elite:** Utiliza processamento em memória e formatos otimizados (**Parquet**) para filtrar milhões de linhas em milissegundos.
- ** AWS Multi-User Ready:** Arquitetura pronta para rodar em clusters **AWS ECS (Fargate)**, suportando múltiplos usuários simultâneos sem conflito de dados graças ao isolamento por `session_id`.
- ** Infraestrutura como Código:** Inclui configurações completas de **Terraform** e **Docker** para deploy profissional.

---

## Funcionalidades Avançadas

- ** Smart JQL (Jira-like Query Language):**
  - Operadores: `=` (Igual), `~` (Contém), `!~` (Não Contém).
  - Lógica complexa: Suporte a `AND`, `OR` e agrupaento recursivo por `( )`.
  - **Auto-Grouping:** Ao clicar em valores da mesma coluna, o JQL agrupa automaticamente com `OR` dentro dos parênteses.
- ** Análise de Distribuição:** Painel lateral interativo que mostra a frequência de valores em tempo real, permitindo filtros rápidos com um clique.
- ** Custom Tagging:** Renomeie seus arquivos no histórico local para facilitar a organização.
- ** Drag & Drop:** Interface fluida com overlay de importação e suporte a arquivos `.csv`, `.parquet` e `.xlsx`.
- ** Exportação Inteligente:** Gere arquivos Excel (.xlsx) filtrados com nomes customizados baseados em suas tags.

---

## Tecnologias

- **Backend:** Python 3.11, Flask, Pandas, Cachelib.
- **Frontend:** HTML5, Vanilla JS (ES6+), Bootstrap 5, IndexedDB.
- **DevOps:** Docker, Docker Compose, Terraform, AWS ECS, ECR.

---

## Como Rodar Localmente

### 1. Via Python Puro
```bash
# Instale as dependências
pip install -r requirements.txt

# Inicie o servidor
python app.py
```
Acesse em: `http://127.0.0.1:5001`

### 2. Via Docker Compose
```bash
docker-compose up --build
```

---

## Deploy na AWS (Pipeline em 1 clique)

Para subir em um ambiente de produção escalável no **AWS ECS Fargate**:

1. Garanta que você tem o **AWS CLI** e **Terraform** instalados.
2. Execute o script de pipeline:
```bash
chmod +x pipeline.sh
./pipeline.sh
```
O script fará o build da imagem, push para o **Amazon ECR**, aplicará o **Terraform** e atualizará o serviço no **ECS**.

**Realize um teste com um arquivo de exemplo**
   [https://www.datablist.com/learn/csv/download-sample-csv-files](https://www.datablist.com/learn/csv/download-sample-csv-files)

---

## Sintaxe JQL

| Operador | Descrição | Exemplo |
| :--- | :--- | :--- |
<<<<<<< HEAD
| `=` | Correspondência exata | `Status = "Concluído"` |
| `~` | Contém o termo | `Nome ~ "Gabriel"` |
| `!~` | Não contém o termo | `Nome !~ "John"` |
| `AND` | Soma condições | `Setor = "TI" AND Salario ~ "5000"` |
| `OR` | Várias condições | `Idate = "26" OR Idade = "25"` |
| `( )` | Agrupamento | `Setor = "TI" AND (Idate = "26" OR Idade = "25")` |
=======
| `=` | Correspondência Exata | `status = "ERROR"` |
| `~` | Busca Parcial (Contém) | `mensagem ~ "timeout"` |
| `!~` | Exclusão (Não Contém) | `url !~ "/health"` |
| `AND` | Cruzamento de Dados | `status = "ERROR" AND user ~ "gabriel"` |
| `OR` | Alternativa de Dados | `(status = "ERROR" OR status = "CRITICAL")` |
>>>>>>> bdf1c50 (feat: adicionando novas features ao README)

---

## Monitoramento de Recursos
A aplicação monitora o **Total Size** do seu banco de dados local (**IndexedDB**) na sidebar. Ao excluir um arquivo, o espaço é liberado instantaneamente tanto no seu navegador quanto no cache temporário do servidor.

---
*Desenvolvido para praticidade e privacidade.*
