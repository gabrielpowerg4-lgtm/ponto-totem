# Ponto Totem

Aplicativo Android (Kotlin + Jetpack Compose) de registro de ponto em tablet, em modo totem.
Esta versão é um APK de validação em **modo demonstração**: não fala com servidor e o
comprovante exibido não tem valor legal.

## Instalar

Baixe o APK mais recente em **Releases** e instale no tablet (Android 10 ou superior).

## Dados de demonstração

| CPF | Senha | Nome |
| --- | --- | --- |
| 111.444.777-35 | 1234 | Ana Souza |
| 529.982.247-25 | 4321 | Carlos Lima |
| 123.456.789-09 | 0000 | Marina Alves |

Área administrativa: toque e segure em "Terminal ..." na tela inicial. Senha: `1234`.

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
