import QRCode from "qrcode";
import {Contact, WechatyBuilder} from "wechaty";
import {ChatGPTBot} from "./chatgpt.js";
import {Config} from "./config";
// Wechaty instance
const weChatBot = WechatyBuilder.build({
    name: "my-wechat-bot",
    puppetOptions: {
        timeoutSeconds: 60,
        // token: "puppet_padlocal_b58032fcdb2a4baea46a47b7f2d1f3db",
    },
    // puppet: "wechaty-puppet-padlocal"
});
// ChatGPTBot instance
const chatGPTBot = new ChatGPTBot();

async function main() {
    weChatBot
        // scan QR code for login
        .on("scan", async (qrcode, status) => {
            const url = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`;
            console.log(`💡 Scan QR Code to login: ${status}\n${url}`);
            console.log(
                await QRCode.toString(qrcode, {type: "terminal", small: true})
            );
        })
        // login to WeChat desktop account
        .on("login", async (user: Contact) => {
            console.log(`✅ User ${user.name()} has logged in`);
            chatGPTBot.setBotName(user.name());
            await chatGPTBot.startGPTBot();
        })
        // message handler
        .on("message", async (message: any) => {
            try {
                console.log(`📨 ${message}`);
                // add your own task handlers over here to expand the bot ability!
                // e.g. if a message starts with "Hello", the bot sends "World!"
                if (message.text().startsWith("Hello")) {
                    await message.say("World!");
                    return;
                }
                if (message.text().startsWith("假期")) {
                    await chatGPTBot.setHoliday(message)
                    return;
                }
                // handle message for chatGPT bot
                await chatGPTBot.onMessage(message);
            } catch (e) {
                console.error(`❌ ${e}`);
            }
        }).on('room-join', async function (room, inviteeList, inviter) {
        await chatGPTBot.onInviteIn(room, inviteeList, inviter);
    });

    try {
        await weChatBot.start();

    } catch (e) {
        console.error(`❌ Your Bot failed to start: ${e}`);
        console.log(
            "🤔 Can you login WeChat in browser? The bot works on the desktop WeChat"
        );
    }
}

main();
