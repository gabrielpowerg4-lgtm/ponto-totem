# Ponto Totem

Aplicativo Android (Kotlin + Jetpack Compose) de registro de ponto em tablet, em modo totem.
Versão de validação: cadastro, autenticação, vivacidade e marcações funcionam no aparelho;
o servidor REP-P (NSR, assinatura, comprovante por e-mail, Bubble) ainda não existe.

## Instalar

Baixe o APK mais recente em **Releases** e instale no tablet (Android 10 ou superior).

## Primeiro uso

1. Na primeira abertura, o app pede a configuração inicial: empresa, obra, responsável,
   identificador do terminal e as duas senhas (administrador e responsável da obra).
2. Na tela inicial, toque e segure em "Terminal ..." para abrir a área administrativa.
   A senha digitada define o perfil.
3. Em "Funcionários da obra", cadastre cada pessoa (nome, CPF, e-mail, senha de ponto)
   e capture a foto de referência.

Sem endereço de servidor configurado, as marcações ficam guardadas no aparelho,
como pendentes, até o servidor existir.

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
