# Ponto Totem

Aplicativo Android (Kotlin + Jetpack Compose) de registro de ponto em tablet, em modo totem.
Versão de validação: cadastro, autenticação, vivacidade e marcações funcionam no aparelho;
as marcações sobem para o serviço REP-P, que atribui o NSR. Assinatura digital, comprovante
por e-mail e Bubble ainda não foram implementados.

## Instalar

Baixe o APK mais recente em **Releases** e instale no tablet (Android 10 ou superior).

## Primeiro uso

1. Na primeira abertura, o app pede a configuração inicial: empresa, obra, responsável,
   identificador do terminal e as duas senhas (administrador e responsável da obra).
2. Na tela inicial, toque e segure em "Terminal ..." para abrir a área administrativa.
   A senha digitada define o perfil.
3. Em "Funcionários da obra", cadastre cada pessoa (nome, CPF, e-mail, senha de ponto)
   e capture a foto de referência.

4. Na área administrativa (perfil administrador), em "Vinculação ao servidor", informe a
   chave da empresa. O servidor registra o terminal na obra e passa a receber as marcações.

Sem vinculação, as marcações ficam guardadas no aparelho, como pendentes.

## Servidor (serviço REP-P)

Roda no Supabase (projeto `ponto-totem-br`, região São Paulo). A API fica em
`supabase/functions/rep` e o banco é criado por migrações aplicadas no próprio projeto.

| Rota | Uso |
| --- | --- |
| `POST /v1/enroll` | Vincula o terminal à empresa e à obra; devolve o token do terminal |
| `POST /v1/punches` | Grava marcações com NSR por obra e hash encadeado; reenvios não duplicam |
| `GET /v1/employees` | Funcionários autorizados na obra do terminal |
| `POST /v1/employees` | Cadastros feitos ou alterados no tablet |
| `GET /v1/time` | Hora do servidor |

## Localização e aparelho

Cada marcação leva a última posição conhecida do tablet (latitude, longitude e precisão),
quando a permissão de localização foi concedida. A marcação nunca espera pelo GPS nem é
bloqueada por falta dele. O servidor também guarda o modelo do aparelho, a versão do
Android, a versão do app e um identificador da instalação, e registra em auditoria a
troca de aparelho de um terminal.

## Arquivos fiscais (AFD e AEJ)

Na área administrativa, perfil administrador, em "Arquivos fiscais". Antes, cadastre os
dados do empregador (CNPJ ou CPF, razão social, CNO da obra, endereço, CPF do responsável) e
o horário contratual da obra. Os arquivos são gerados no servidor, por obra e período:

- **AFD** (leiaute 003): cabeçalho, registros tipo 2 (empresa), tipo 5 (funcionários) e
  tipo 7 (marcações), trailer e linha de assinatura. CRC-16 nos tipos 1 a 5 e hash SHA-256
  encadeado no tipo 7, conferido na geração.
- **AEJ** (leiaute 002): empregador, REP, vínculos, horário contratual, marcações em pares de
  entrada e saída por dia e identificação do programa.

Ainda faltam a assinatura digital (.p7s, depende do certificado ICP-Brasil), o número de
registro no INPI e os dados do desenvolvedor. O AEJ não trata ausências nem banco de horas.

## Validação facial

Depois da piscada (vivacidade), o app compara o rosto com a foto de referência do
funcionário, tudo no aparelho, com o modelo MobileFaceNet (ver `THIRD_PARTY.md`). A
semelhança mínima é configurável na área administrativa (padrão 0.50). Se o rosto não
conferir em 3 tentativas, a marcação é registrada e sinalizada, nunca bloqueada.

A tabela de marcações só aceita inserção. Ainda não há assinatura digital, comprovante em
PDF, envio por e-mail, AFD nem integração com o Bubble.

## Modo totem completo (opcional)

Em um tablet sem contas configuradas, com depuração USB ativa:

```
adb shell dpm set-device-owner br.com.pontototem/.kiosk.AdminReceiver
```

Com isso o app trava o aparelho, concede a câmera a si mesmo e abre após reiniciar.

## Compilar

```
./gradlew assembleDebug
```

O GitHub Actions compila a cada envio para `main` e publica o APK em Releases.
A chave em `keystore/` é só para validação.
