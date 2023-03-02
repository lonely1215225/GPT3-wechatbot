import {Config} from "./config.js";
// @ts-ignore
import {Message, users} from "wechaty";
import {ContactInterface, RoomInterface} from "wechaty/impls";
import {Configuration, OpenAIApi} from "openai";
import request from "http";
import {FileBox} from 'file-box';


// ChatGPT error response configuration
const chatgptErrorMessage = "🤖️：机器人摆烂了，我可不背锅，这是openai的偶现问题，在尝试一次就好啦~";

let [Q, A] = ["Human: ", "AI: "];
let identity = 'You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possiboe.\nCurrent data:' + new Date().toLocaleString();
// ChatGPT model configuration
// please refer to the OpenAI API doc: https://beta.openai.com/docs/api-reference/introduction
const ChatGPTModelConfig = {
    // this model field is required
    model: "gpt-3.5-turbo",
    // add your ChatGPT model parameters below
    temperature: 0.9,
    max_tokens: 2000,
    presence_penalty: 0.6
};
let myMap = new Map();


// message size for a single reply by the bot
const SINGLE_MESSAGE_MAX_SIZE = 500;

enum MessageType {
    Unknown = 0,
    Attachment = 1, // Attach(6),
    Audio = 2, // Audio(1), Voice(34)
    Contact = 3, // ShareCard(42)
    ChatHistory = 4, // ChatHistory(19)
    Emoticon = 5, // Sticker: Emoticon(15), Emoticon(47)
    Image = 6, // Img(2), Image(3)
    Text = 7, // Text(1)
    Location = 8, // Location(48)
    MiniProgram = 9, // MiniProgram(33)
    GroupNote = 10, // GroupNote(53)
    Transfer = 11, // Transfers(2000)
    RedEnvelope = 12, // RedEnvelopes(2001)
    Recalled = 13, // Recalled(10002)
    Url = 14, // Url(5)
    Video = 15, // Video(4), Video(43)
    Post = 16, // Moment, Channel, Tweet, etc
}

export class ChatGPTBot {
    botName: string = "";
    chatgptTriggerKeyword = Config.chatgptTriggerKeyword;
    OpenAIConfig: any;  // OpenAI API key
    OpenAI: any;        // OpenAI API instance

    async setHoliday(message: Message) {
        request.get("http://127.0.0.1:8080/holiday/info", res => {
            const {statusCode} = res;
            const contentType = res.headers['content-type'];

            let error;
            // Any 2xx status code signals a successful response but
            // here we're only checking for 200.
            if (statusCode !== 200) {
                error = new Error('Request Failed.\n' +
                    `Status Code: ${statusCode}`);
            } else if (!/^application\/json/.test(<string>contentType)) {
            }
            if (error) {
                console.error(error.message);
                // Consume response data to free up memory
                res.resume();
                return;
            }

            res.setEncoding('utf8');
            let rawData = '';
            res.on('data', (chunk) => {
                rawData += chunk;
            });
            res.on('end', () => {
                try {
                    var room = message.room();
                    if (!room && message.type() == MessageType.Text) {
                        this.onPrivateMessage(message.talker(), rawData, false);
                    } else if (room != undefined) {
                        this.onGroupMessage(rawData, room, false);
                    }
                    return rawData;
                } catch (e) {
                    // @ts-ignore
                    console.error(e.message);
                }
            });
        }).on('error', (e) => {
            console.error(`Got error: ${e.message}`);
        });
        return "";
    }

    setBotName(botName: string) {
        this.botName = botName;
    }

    // get trigger keyword in group chat: (@Name <keyword>)
    get chatGroupTriggerKeyword(): string {
        return `@${this.botName}`;
    }

    // configure API with model API keys and run a initial test
    async startGPTBot() {
        // OpenAI Account configuration
        this.OpenAIConfig = new Configuration({
            organization: Config.openaiOrganizationID,
            apiKey: Config.openaiApiKey,
        });
        // OpenAI API instance
        this.OpenAI = new OpenAIApi(this.OpenAIConfig);
        // Run an initial test to confirm API works fine
        const chatgptReplyMessage = await this.onChatGPT(identity, "hello");
        console.log(`🤖️ ChatGPT Bot Start Success, ready to handle message!`);
    }

    // get clean message by removing reply separater and group mention characters
    cleanMessage(rawText: string, isPrivateChat: boolean = false): string {
        let text = rawText;
        const item = rawText.split("- - - - - - - - - - - - - - -");
        if (item.length > 1) {
            text = item[item.length - 1];
        }
        text = text.replace(
            isPrivateChat ? this.chatgptTriggerKeyword : this.chatGroupTriggerKeyword,
            ""
        );
        return text;
    }

    // check whether ChatGPT bot can be triggered

    triggerGPTMessage(text: string, isPrivateChat: boolean = false): boolean {
        const chatgptTriggerKeyword = this.chatgptTriggerKeyword;
        let triggered = false;
        if (isPrivateChat) {
            triggered = chatgptTriggerKeyword
                ? text.includes(chatgptTriggerKeyword)
                : true;
        } else {
            triggered = text.includes(this.chatGroupTriggerKeyword);
        }
        if (triggered) {
            console.log(`🎯 ChatGPT Triggered: ${text}`);
        }
        return triggered;
    }

    // filter out the message that does not need to be processed


    isNonsense(
        talker: ContactInterface,
        messageType: MessageType,
        text: string
    ): boolean {
        return (
            // self-chatting can be used for testing
            // talker.self() ||
            messageType > MessageType.GroupNote ||
            talker.name() == "微信团队" ||
            // video or voice reminder
            text.includes("收到一条视频/语音聊天消息，请在手机上查看") ||
            // red pocket reminder
            text.includes("收到红包，请在手机上查看") ||
            // location information
            text.includes("/cgi-bin/mmwebwx-bin/webwxgetpubliclinkimg")
        );
    }

    // send question to ChatGPT with OpenAI API and get answer
    async onChatGPT(inputMessage: string, id: string): Promise<String> {

        if (inputMessage.includes("/cc")) {
            myMap.set(id, []);
            return "上下文已清理!";
        }
        if (id == "hello") {
            return "ok"
        }
        let cachedMsg = myMap.get(id);
        try {
            if (!cachedMsg) {
                cachedMsg = [];
                cachedMsg.push({role: "system", content: `${identity}`})
            }
            cachedMsg.push({role: "user", content: inputMessage})

            console.log(cachedMsg.reduce((acc: any, cur: string | any[]) => acc + cur.length, 0));
            if (cachedMsg.length > 5) {
                cachedMsg.shift();
            }

            // config OpenAI API request body
            // This model's maximum context length is 4097 tokens, however you requested 4123 tokens (2123 in your prompt; 2000 for the completion). Please reduce your prompt; or completion length

            const prompt = JSON.stringify(cachedMsg);
            console.log("send to gpt::" + prompt)

            const response = await this.OpenAI.createChatCompletion(
                {
                    ...ChatGPTModelConfig,
                    messages: cachedMsg
                }
            );
            const messageResp = response.data.choices[0].message;            // use OpenAI API to get ChatGPT reply message

            console.log("🤖️ ChatGPT says: ", messageResp);

            cachedMsg.push(messageResp);

            myMap.set(id, cachedMsg);

            return messageResp.content;

        } catch (e: any) {
            const errorResponse = e?.response;
            const errorCode = errorResponse?.status;
            const errorStatus = errorResponse?.statusText;
            const errorMessage = errorResponse?.data?.error?.message;
            console.log(`❌ Code ${errorCode}: ${errorStatus}`);
            console.log(`❌ ${errorMessage}`);
            if (errorCode == 400) {
                cachedMsg = [];
                myMap.set(id, cachedMsg);
                await this.onChatGPT(inputMessage, id);
                cachedMsg.push({role: "system", content: `${identity}`})
            }
            return chatgptErrorMessage;
        }
    }

    // reply with the segmented messages from a single-long message
    async reply(
        talker: RoomInterface | ContactInterface,
        mesasge: any
    ): Promise<void> {
        const messages: Array<string> = [];
        let message = mesasge;
        while (message.length > SINGLE_MESSAGE_MAX_SIZE) {
            messages.push(message.slice(0, SINGLE_MESSAGE_MAX_SIZE));
            message = message.slice(SINGLE_MESSAGE_MAX_SIZE);
        }
        messages.push(message);
        for (const msg of messages) {
            await talker.say(msg);
        }
    }

    // reply to private message
    async onPrivateMessage(talker: ContactInterface, text: string, gpt: boolean) {
        // get reply from ChatGPT
        let chatgptReplyMessage;
        if (gpt) {
            if (text.includes("img")) {
                await this.handleImgMessage(text, talker);
                return;
            }
            chatgptReplyMessage = await this.onChatGPT(text, talker.id);
        } else {
            chatgptReplyMessage = text;
        }
        // send the ChatGPT reply to chat
        await this.reply(talker, chatgptReplyMessage);
    }

    // reply to group message
    async onGroupMessage(text: string, room: RoomInterface, gpt: boolean) {
        // get reply from ChatGPT
        let chatgptReplyMessage;
        let result;
        if (gpt) {
            const txt = text.replace(" ", "");
            if (txt.includes("img")) {
                await this.handleImgMessage(text, room);
                return;
            } else {
                let punctuation = ",.;!?，。！？、…";
                let lastStr = text.at(text.length - 1);
                if (lastStr != undefined && !punctuation.includes(lastStr)) {
                    text = text + "?";
                }
                console.log("send to gpt:" + text);
                chatgptReplyMessage = await this.onChatGPT(text, room.id);
                result = `${text}\n ---------- \n ${chatgptReplyMessage}`;
            }
        } else {
            result = text;
        }
        // the reply consist of: original text and bot reply
        await this.reply(room, result);
    }

    async handleImgMessage(text: string, room: RoomInterface | ContactInterface) {
        const s = text.substring(4);

        const prompt = s.replace("?", "").toString()
        let payload = {
            "prompt": prompt,
            "steps": 20,
            "sampler_name": ""
        }
        const postData = JSON.stringify(payload);

        const options = {
            hostname: "9.134.172.52",
            port: 7860,
            path: '/sdapi/v1/txt2img',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            body: payload
        };
        const req = request.request(options, (res) => {
            console.log(`STATUS: ${res.statusCode}`);
            console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
            res.setEncoding('utf8');
            let resp: string;
            res.on('data', (chunk) => {
                resp += chunk;
            });
            res.on('end', async () => {
                resp = JSON.parse(resp.replace("undefined", ""));
                // @ts-ignore
                resp = resp.images;

                const fileBox = FileBox.fromBase64(resp + "")
                await fileBox.toFile("./cat.png", true);
                await room.say(FileBox.fromFile("./cat.png"));
                console.log('No more data in response.');
            });
        });

        req.on('error', (e) => {
            console.error(`problem with request: ${e.message}`);
        });

        // Write data to request body
        req.write(postData);
        req.end();

        // const s = text.substring(4);
        // let response = await this.OpenAI.createImage({
        //     prompt: s.replace("?", "").toString(),
        //     size: "512x512"
        // });
        // let url = response.data.data[0].url;
        // console.log(url)
        // const fileBox = FileBox.fromUrl(url);
        console.log("图片已发送")
        return;

    }

    // receive a message (main entry)
    async onMessage(message: Message) {
        const talker = message.talker();
        const rawText = message.text();
        const room = message.room();
        const messageType = message.type();
        const isPrivateChat = !room;
        // do nothing if the message:
        //    1. is irrelevant (e.g. voice, video, location...), or
        //    2. doesn't trigger bot (e.g. wrong trigger-word)

        if (
            this.isNonsense(talker, messageType, rawText) ||
            !this.triggerGPTMessage(rawText, isPrivateChat)
        ) {
            return;
        }
        // clean the message for ChatGPT input
        const text = this.cleanMessage(rawText, isPrivateChat);

        // reply to private or group chat
        console.log("send to gpt:" + text)
        if (text.includes("/identity")) {
            identity = text.replace("identity:", "");
            console.log("现在我的身份规则是:" + identity);
            if (isPrivateChat && messageType == MessageType.Text) {
                return await this.reply(talker, "as you wish!");
            } else if (room != undefined) {
                return await this.reply(room, "as you wish!");
            }
            return;
        }

        if (isPrivateChat && messageType == MessageType.Text) {
            return await this.onPrivateMessage(talker, text, true);
        } else if (room != undefined) {
            return await this.onGroupMessage(text, room, true);
        }
    }

    async onInviteIn(room: users.Room, inviteeList: any[], inviter: users.Contact) {
        if (!Config.welcomeToGroup) {
            return;
        }
        console.log('bot room-join room id:', room.id)
        console.info('Bot', 'EVENT: room-join - Room "%s" got new member "%s", invited by "%s"',
            await room.topic(),
            inviteeList.map(c => c.name()).join(','),
            inviter.name(),
        )
        const topic = await room.topic()
        await room.say(`welcome to "${topic}" 👏🏻👏🏻👏🏻!`, inviteeList[0])

    }
}
