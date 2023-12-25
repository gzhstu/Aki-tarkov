import { inject, injectable } from "tsyringe";

import { IDialogueChatBot } from "@spt-aki/helpers/Dialogue/IDialogueChatBot";
import { ProfileHelper } from "@spt-aki/helpers/ProfileHelper";
import { ISendMessageRequest } from "@spt-aki/models/eft/dialog/ISendMessageRequest";
import { IUserDialogInfo } from "@spt-aki/models/eft/profile/IAkiProfile";
import { ConfigTypes } from "@spt-aki/models/enums/ConfigTypes";
import { GiftSentResult } from "@spt-aki/models/enums/GiftSentResult";
import { MemberCategory } from "@spt-aki/models/enums/MemberCategory";
import { ICoreConfig } from "@spt-aki/models/spt/config/ICoreConfig";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { GiftService } from "@spt-aki/services/GiftService";
import { MailSendService } from "@spt-aki/services/MailSendService";
import { RandomUtil } from "@spt-aki/utils/RandomUtil";

@injectable()
export class SptDialogueChatBot implements IDialogueChatBot
{
    protected coreConfig: ICoreConfig;
    public constructor(
        @inject("ProfileHelper") protected profileHelper: ProfileHelper,
        @inject("RandomUtil") protected randomUtil: RandomUtil,
        @inject("MailSendService") protected mailSendService: MailSendService,
        @inject("GiftService") protected giftService: GiftService,
        @inject("ConfigServer") protected configServer: ConfigServer
    )
    {
        this.coreConfig = this.configServer.getConfig(ConfigTypes.CORE);
    }

    public getChatBot(): IUserDialogInfo
    {
        return {
            _id: "sptFriend",
            info: {
                Level: 1,
                MemberCategory: MemberCategory.DEVELOPER,
                Nickname: this.coreConfig.sptFriendNickname,
                Side: "Usec",
            },
        };
    }

    /**
     * Send responses back to player when they communicate with SPT friend on friends list
     * @param sessionId Session Id
     * @param request send message request
     */
    public handleMessage(sessionId: string, request: ISendMessageRequest): string
    {
        const sender = this.profileHelper.getPmcProfile(sessionId);

        const sptFriendUser = this.getChatBot();

        const giftSent = this.giftService.sendGiftToPlayer(sessionId, request.text);

        if (giftSent === GiftSentResult.SUCCESS)
        {
            this.mailSendService.sendUserMessageToPlayer(
                sessionId,
                sptFriendUser,
                this.randomUtil.getArrayValue([
                    "Hey! you got the right code!",
                    "A secret code, how exciting!",
                    "You found a gift code!",
                ])
            );

            return;
        }

        if (giftSent === GiftSentResult.FAILED_GIFT_ALREADY_RECEIVED)
        {
            this.mailSendService.sendUserMessageToPlayer(
                sessionId,
                sptFriendUser,
                this.randomUtil.getArrayValue(["Looks like you already used that code", "You already have that!!"])
            );

            return;
        }

        if (request.text.toLowerCase().includes("love you"))
        {
            this.mailSendService.sendUserMessageToPlayer(
                sessionId,
                sptFriendUser,
                this.randomUtil.getArrayValue([
                    "That's quite forward but i love you too in a purely chatbot-human way",
                    "I love you too buddy :3!",
                    "uwu",
                    `love you too ${sender?.Info?.Nickname}`,
                ])
            );
        }

        if (request.text.toLowerCase() === "spt")
        {
            this.mailSendService.sendUserMessageToPlayer(
                sessionId,
                sptFriendUser,
                this.randomUtil.getArrayValue(["Its me!!", "spt? i've heard of that project"])
            );
        }

        if (["hello", "hi", "sup", "yo", "hey"].includes(request.text.toLowerCase()))
        {
            this.mailSendService.sendUserMessageToPlayer(
                sessionId,
                sptFriendUser,
                this.randomUtil.getArrayValue([
                    "Howdy",
                    "Hi",
                    "Greetings",
                    "Hello",
                    "bonjor",
                    "Yo",
                    "Sup",
                    "Heyyyyy",
                    "Hey there",
                    `Hello ${sender?.Info?.Nickname}`,
                ])
            );
        }

        if (request.text.toLowerCase() === "nikita")
        {
            this.mailSendService.sendUserMessageToPlayer(
                sessionId,
                sptFriendUser,
                this.randomUtil.getArrayValue([
                    "I know that guy!",
                    "Cool guy, he made EFT!",
                    "Legend",
                    "Remember when he said webel-webel-webel-webel, classic nikita moment",
                ])
            );
        }

        if (request.text.toLowerCase() === "are you a bot")
        {
            this.mailSendService.sendUserMessageToPlayer(
                sessionId,
                sptFriendUser,
                this.randomUtil.getArrayValue(["beep boop", "**sad boop**", "probably", "sometimes", "yeah lol"])
            );
        }

        return request.dialogId;
    }
}
