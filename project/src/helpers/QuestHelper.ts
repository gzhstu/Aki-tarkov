import { inject, injectable } from "tsyringe";

import { DialogueHelper } from "@spt-aki/helpers/DialogueHelper";
import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { PaymentHelper } from "@spt-aki/helpers/PaymentHelper";
import { ProfileHelper } from "@spt-aki/helpers/ProfileHelper";
import { QuestConditionHelper } from "@spt-aki/helpers/QuestConditionHelper";
import { RagfairServerHelper } from "@spt-aki/helpers/RagfairServerHelper";
import { TraderHelper } from "@spt-aki/helpers/TraderHelper";
import { IPmcData } from "@spt-aki/models/eft/common/IPmcData";
import { Common, IQuestStatus } from "@spt-aki/models/eft/common/tables/IBotBase";
import { Item } from "@spt-aki/models/eft/common/tables/IItem";
import { AvailableForConditions, AvailableForProps, IQuest, Reward } from "@spt-aki/models/eft/common/tables/IQuest";
import { IItemEventRouterResponse } from "@spt-aki/models/eft/itemEvent/IItemEventRouterResponse";
import { IAcceptQuestRequestData } from "@spt-aki/models/eft/quests/IAcceptQuestRequestData";
import { IFailQuestRequestData } from "@spt-aki/models/eft/quests/IFailQuestRequestData";
import { ConfigTypes } from "@spt-aki/models/enums/ConfigTypes";
import { MessageType } from "@spt-aki/models/enums/MessageType";
import { QuestRewardType } from "@spt-aki/models/enums/QuestRewardType";
import { QuestStatus } from "@spt-aki/models/enums/QuestStatus";
import { SkillTypes } from "@spt-aki/models/enums/SkillTypes";
import { IQuestConfig } from "@spt-aki/models/spt/config/IQuestConfig";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { EventOutputHolder } from "@spt-aki/routers/EventOutputHolder";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { LocaleService } from "@spt-aki/services/LocaleService";
import { LocalisationService } from "@spt-aki/services/LocalisationService";
import { MailSendService } from "@spt-aki/services/MailSendService";
import { HashUtil } from "@spt-aki/utils/HashUtil";
import { JsonUtil } from "@spt-aki/utils/JsonUtil";
import { TimeUtil } from "@spt-aki/utils/TimeUtil";

@injectable()
export class QuestHelper
{
    protected questConfig: IQuestConfig;

    constructor(
        @inject("WinstonLogger") protected logger: ILogger,
        @inject("JsonUtil") protected jsonUtil: JsonUtil,
        @inject("TimeUtil") protected timeUtil: TimeUtil,
        @inject("HashUtil") protected hashUtil: HashUtil,
        @inject("ItemHelper") protected itemHelper: ItemHelper,
        @inject("QuestConditionHelper") protected questConditionHelper: QuestConditionHelper,
        @inject("EventOutputHolder") protected eventOutputHolder: EventOutputHolder,
        @inject("DatabaseServer") protected databaseServer: DatabaseServer,
        @inject("LocaleService") protected localeService: LocaleService,
        @inject("RagfairServerHelper") protected ragfairServerHelper: RagfairServerHelper,
        @inject("DialogueHelper") protected dialogueHelper: DialogueHelper,
        @inject("ProfileHelper") protected profileHelper: ProfileHelper,
        @inject("PaymentHelper") protected paymentHelper: PaymentHelper,
        @inject("LocalisationService") protected localisationService: LocalisationService,
        @inject("TraderHelper") protected traderHelper: TraderHelper,
        @inject("MailSendService") protected mailSendService: MailSendService,
        @inject("ConfigServer") protected configServer: ConfigServer,
    )
    {
        this.questConfig = this.configServer.getConfig(ConfigTypes.QUEST);
    }

    /**
     * Get status of a quest in player profile by its id
     * @param pmcData Profile to search
     * @param questId Quest id to look up
     * @returns QuestStatus enum
     */
    public getQuestStatus(pmcData: IPmcData, questId: string): QuestStatus
    {
        const quest = pmcData.Quests?.find((q) => q.qid === questId);

        return quest ? quest.status : QuestStatus.Locked;
    }

    /**
     * returns true is the level condition is satisfied
     * @param playerLevel Players level
     * @param condition Quest condition
     * @returns true if player level is greater than or equal to quest
     */
    public doesPlayerLevelFulfilCondition(playerLevel: number, condition: AvailableForConditions): boolean
    {
        if (condition._parent === "Level")
        {
            switch (condition._props.compareMethod)
            {
                case ">=":
                    return playerLevel >= <number>condition._props.value;
                case ">":
                    return playerLevel > <number>condition._props.value;
                case "<":
                    return playerLevel < <number>condition._props.value;
                case "<=":
                    return playerLevel <= <number>condition._props.value;
                case "=":
                    return playerLevel === <number>condition._props.value;
                default:
                    this.logger.error(
                        this.localisationService.getText(
                            "quest-unable_to_find_compare_condition",
                            condition._props.compareMethod,
                        ),
                    );
                    return false;
            }
        }
    }

    /**
     * Get the quests found in both arrays (inner join)
     * @param before Array of quests #1
     * @param after Array of quests #2
     * @returns Reduction of cartesian product between two quest arrays
     */
    public getDeltaQuests(before: IQuest[], after: IQuest[]): IQuest[]
    {
        const knownQuestsIds = [];
        for (const q of before)
        {
            knownQuestsIds.push(q._id);
        }

        if (knownQuestsIds.length)
        {
            return after.filter((q) =>
            {
                return knownQuestsIds.indexOf(q._id) === -1;
            });
        }

        return after;
    }

    /**
     * Adjust skill experience for low skill levels, mimicing the official client
     * @param profileSkill the skill experience is being added to
     * @param progressAmount the amount of experience being added to the skill
     * @returns the adjusted skill progress gain
     */
    public adjustSkillExpForLowLevels(profileSkill: Common, progressAmount: number): number
    {
        let currentLevel = Math.floor(profileSkill.Progress / 100);

        // Only run this if the current level is under 9
        if (currentLevel >= 9)
        {
            return progressAmount;
        }

        // This calculates how much progress we have in the skill's starting level
        let startingLevelProgress = (profileSkill.Progress % 100) * ((currentLevel + 1) / 10);

        // The code below assumes a 1/10th progress skill amount
        let remainingProgress = progressAmount / 10;

        // We have to do this loop to handle edge cases where the provided XP bumps your level up
        // See "CalculateExpOnFirstLevels" in client for original logic
        let adjustedSkillProgress = 0;
        while (remainingProgress > 0 && currentLevel < 9)
        {
            // Calculate how much progress to add, limiting it to the current level max progress
            const currentLevelRemainingProgress = ((currentLevel + 1) * 10) - startingLevelProgress;
            this.logger.debug(`currentLevelRemainingProgress: ${currentLevelRemainingProgress}`);
            const progressToAdd = Math.min(remainingProgress, currentLevelRemainingProgress);
            const adjustedProgressToAdd = (10 / (currentLevel + 1)) * progressToAdd;
            this.logger.debug(`Progress To Add: ${progressToAdd}  Adjusted for level: ${adjustedProgressToAdd}`);

            // Add the progress amount adjusted by level
            adjustedSkillProgress += adjustedProgressToAdd;
            remainingProgress -= progressToAdd;
            startingLevelProgress = 0;
            currentLevel++;
        }

        // If there's any remaining progress, add it. This handles if you go from level 8 -> 9
        if (remainingProgress > 0)
        {
            adjustedSkillProgress += remainingProgress;
        }

        return adjustedSkillProgress;
    }

    /**
     * Get quest name by quest id
     * @param questId id to get
     * @returns
     */
    public getQuestNameFromLocale(questId: string): string
    {
        const questNameKey = `${questId} name`;
        return this.localeService.getLocaleDb()[questNameKey];
    }

    /**
     * Check if trader has sufficient loyalty to fulfill quest requirement
     * @param questProperties Quest props
     * @param profile Player profile
     * @returns true if loyalty is high enough to fulfill quest requirement
     */
    public traderLoyaltyLevelRequirementCheck(questProperties: AvailableForProps, profile: IPmcData): boolean
    {
        const requiredLoyaltyLevel = Number(questProperties.value);
        const trader = profile.TradersInfo[<string>questProperties.target];
        if (!trader)
        {
            this.logger.error(`Unable to find trader: ${questProperties.target} in profile`);
        }

        return this.compareAvailableForValues(trader.loyaltyLevel, requiredLoyaltyLevel, questProperties.compareMethod);
    }

    /**
     * Check if trader has sufficient standing to fulfill quest requirement
     * @param questProperties Quest props
     * @param profile Player profile
     * @returns true if standing is high enough to fulfill quest requirement
     */
    public traderStandingRequirementCheck(questProperties: AvailableForProps, profile: IPmcData): boolean
    {
        const requiredStanding = Number(questProperties.value);
        const trader = profile.TradersInfo[<string>questProperties.target];
        if (!trader)
        {
            this.logger.error(`Unable to find trader: ${questProperties.target} in profile`);
        }

        return this.compareAvailableForValues(trader.standing, requiredStanding, questProperties.compareMethod);
    }

    protected compareAvailableForValues(current: number, required: number, compareMethod: string): boolean
    {
        switch (compareMethod)
        {
            case ">=":
                return current >= required;
            case ">":
                return current > required;
            case "<=":
                return current <= required;
            case "<":
                return current < required;
            case "!=":
                return current !== required;
            case "==":
                return current === required;

            default:
                this.logger.error(this.localisationService.getText("quest-compare_operator_unhandled", compareMethod));

                return false;
        }
    }

    /**
     * take reward item from quest and set FiR status + fix stack sizes + fix mod Ids
     * @param reward Reward item to fix
     * @returns Fixed rewards
     */
    protected processReward(reward: Reward): Reward[]
    {
        let rewardItems: Reward[] = [];
        let targets: Item[] = [];
        const mods: Item[] = [];

        for (const item of reward.items)
        {
            // reward items are granted Found in Raid status
            if (!item.upd)
            {
                item.upd = {};
            }

            item.upd.SpawnedInSession = true;

            // separate base item and mods, fix stacks
            if (item._id === reward.target)
            {
                if (
                    (item.parentId !== undefined) && (item.parentId === "hideout")
                    && (item.upd !== undefined) && (item.upd.StackObjectsCount !== undefined)
                    && (item.upd.StackObjectsCount > 1)
                )
                {
                    item.upd.StackObjectsCount = 1;
                }
                targets = this.itemHelper.splitStack(item);
                // splitStack created new ids for the new stacks. This would destroy the relation to possible children.
                // Instead, we reset the id to preserve relations and generate a new id in the downstream loop, where we are also reparenting if required
                for (const target of targets)
                {
                    target._id = item._id;
                }
            }
            else
            {
                mods.push(item);
            }
        }

        // Add mods to the base items, fix ids
        for (const target of targets)
        {
            // This has all the original id relations since we reset the id to the original after the splitStack
            const items = [this.jsonUtil.clone(target)];
            // Here we generate a new id for the root item
            target._id = this.hashUtil.generate();

            for (const mod of mods)
            {
                items.push(this.jsonUtil.clone(mod));
            }

            rewardItems = rewardItems.concat(<Reward[]>this.ragfairServerHelper.reparentPresets(target, items));
        }

        return rewardItems;
    }

    /**
     * Gets a flat list of reward items for the given quest at a specific state (e.g. Fail/Success)
     * @param quest quest to get rewards for
     * @param status Quest status that holds the items (Started, Success, Fail)
     * @returns array of items with the correct maxStack
     */
    public getQuestRewardItems(quest: IQuest, status: QuestStatus): Reward[]
    {
        // Iterate over all rewards with the desired status, flatten out items that have a type of Item
        const questRewards = quest.rewards[QuestStatus[status]].flatMap((reward: Reward) =>
            reward.type === "Item" ? this.processReward(reward) : []
        );

        return questRewards;
    }

    /**
     * Look up quest in db by accepted quest id and construct a profile-ready object ready to store in profile
     * @param pmcData Player profile
     * @param newState State the new quest should be in when returned
     * @param acceptedQuest Details of accepted quest from client
     */
    public getQuestReadyForProfile(
        pmcData: IPmcData,
        newState: QuestStatus,
        acceptedQuest: IAcceptQuestRequestData,
    ): IQuestStatus
    {
        const currentTimestamp = this.timeUtil.getTimestamp();
        const existingQuest = pmcData.Quests.find((q) => q.qid === acceptedQuest.qid);
        if (existingQuest)
        {
            // Quest exists, update its status
            existingQuest.startTime = currentTimestamp;
            existingQuest.status = newState;
            existingQuest.statusTimers[newState] = currentTimestamp;
            existingQuest.completedConditions = [];

            if (existingQuest.availableAfter)
            {
                delete existingQuest.availableAfter;
            }

            return existingQuest;
        }

        // Quest doesn't exists, add it
        const newQuest: IQuestStatus = {
            qid: acceptedQuest.qid,
            startTime: currentTimestamp,
            status: newState,
            statusTimers: {},
        };

        // Check if quest has a prereq to be placed in a 'pending' state
        const questDbData = this.getQuestFromDb(acceptedQuest.qid, pmcData);
        const waitTime = questDbData.conditions.AvailableForStart.find((x) => x._props.availableAfter > 0);
        if (waitTime && acceptedQuest.type !== "repeatable")
        {
            // Quest should be put into 'pending' state
            newQuest.startTime = 0;
            newQuest.status = QuestStatus.AvailableAfter; // 9
            newQuest.availableAfter = currentTimestamp + waitTime._props.availableAfter;
        }
        else
        {
            newQuest.statusTimers[newState.toString()] = currentTimestamp;
            newQuest.completedConditions = [];
        }

        return newQuest;
    }

    /**
     * Get quests that can be shown to player after starting a quest
     * @param startedQuestId Quest started by player
     * @param sessionID Session id
     * @returns Quests accessible to player incuding newly unlocked quests now quest (startedQuestId) was started
     */
    public getNewlyAccessibleQuestsWhenStartingQuest(startedQuestId: string, sessionID: string): IQuest[]
    {
        // Get quest acceptance data from profile
        const profile: IPmcData = this.profileHelper.getPmcProfile(sessionID);
        const startedQuestInProfile = profile.Quests.find((x) => x.qid === startedQuestId);

        // Get quests that
        const eligibleQuests = this.getQuestsFromDb().filter((quest) =>
        {
            // Quest is accessible to player when the accepted quest passed into param is started
            // e.g. Quest A passed in, quest B is looped over and has requirement of A to be started, include it
            const acceptedQuestCondition = quest.conditions.AvailableForStart.find((x) =>
            {
                return x._parent === "Quest"
                    && x._props.target === startedQuestId
                    && x._props.status[0] === QuestStatus.Started;
            });

            // Not found, skip quest
            if (!acceptedQuestCondition)
            {
                return false;
            }

            const standingRequirements = this.questConditionHelper.getStandingConditions(
                quest.conditions.AvailableForStart,
            );
            for (const condition of standingRequirements)
            {
                if (!this.traderStandingRequirementCheck(condition._props, profile))
                {
                    return false;
                }
            }

            const loyaltyRequirements = this.questConditionHelper.getLoyaltyConditions(
                quest.conditions.AvailableForStart,
            );
            for (const condition of loyaltyRequirements)
            {
                if (!this.traderLoyaltyLevelRequirementCheck(condition._props, profile))
                {
                    return false;
                }
            }

            // Include if quest found in profile and is started or ready to hand in
            return startedQuestInProfile
                && ([QuestStatus.Started, QuestStatus.AvailableForFinish].includes(startedQuestInProfile.status));
        });

        return this.getQuestsWithOnlyLevelRequirementStartCondition(eligibleQuests);
    }

    /**
     * Get quests that can be shown to player after failing a quest
     * @param failedQuestId Id of the quest failed by player
     * @param sessionId Session id
     * @returns IQuest array
     */
    public failedUnlocked(failedQuestId: string, sessionId: string): IQuest[]
    {
        const profile = this.profileHelper.getPmcProfile(sessionId);
        const profileQuest = profile.Quests.find((x) => x.qid === failedQuestId);

        const quests = this.getQuestsFromDb().filter((q) =>
        {
            const acceptedQuestCondition = q.conditions.AvailableForStart.find((c) =>
            {
                return c._parent === "Quest"
                    && c._props.target === failedQuestId
                    && c._props.status[0] === QuestStatus.Fail;
            });

            if (!acceptedQuestCondition)
            {
                return false;
            }

            return profileQuest && (profileQuest.status === QuestStatus.Fail);
        });

        if (quests.length === 0)
        {
            return quests;
        }

        return this.getQuestsWithOnlyLevelRequirementStartCondition(quests);
    }

    /**
     * Adjust quest money rewards by passed in multiplier
     * @param quest Quest to multiple money rewards
     * @param multiplier Value to adjust money rewards by
     * @param questStatus Status of quest to apply money boost to rewards of
     * @returns Updated quest
     */
    public applyMoneyBoost(quest: IQuest, multiplier: number, questStatus: QuestStatus): IQuest
    {
        const rewards: Reward[] = quest.rewards?.[QuestStatus[questStatus]] ?? [];
        for (const reward of rewards)
        {
            if (reward.type === "Item")
            {
                if (this.paymentHelper.isMoneyTpl(reward.items[0]._tpl))
                {
                    reward.items[0].upd.StackObjectsCount += Math.round(
                        reward.items[0].upd.StackObjectsCount * multiplier / 100,
                    );
                }
            }
        }

        return quest;
    }

    /**
     * Sets the item stack to new value, or delete the item if value <= 0
     * // TODO maybe merge this function and the one from customization
     * @param pmcData Profile
     * @param itemId id of item to adjust stack size of
     * @param newStackSize Stack size to adjust to
     * @param sessionID Session id
     * @param output ItemEvent router response
     */
    public changeItemStack(
        pmcData: IPmcData,
        itemId: string,
        newStackSize: number,
        sessionID: string,
        output: IItemEventRouterResponse,
    ): void
    {
        const inventoryItemIndex = pmcData.Inventory.items.findIndex((item) => item._id === itemId);
        if (inventoryItemIndex < 0)
        {
            this.logger.error(this.localisationService.getText("quest-item_not_found_in_inventory", itemId));

            return;
        }

        if (newStackSize > 0)
        {
            const item = pmcData.Inventory.items[inventoryItemIndex];
            if (!item.upd)
            {
                item.upd = {};
            }
            item.upd.StackObjectsCount = newStackSize;

            this.addItemStackSizeChangeIntoEventResponse(output, sessionID, item);
        }
        else
        {
            // this case is probably dead Code right now, since the only calling function
            // checks explicitly for Value > 0.
            output.profileChanges[sessionID].items.del.push({ _id: itemId });
            pmcData.Inventory.items.splice(inventoryItemIndex, 1);
        }
    }

    /**
     * Add item stack change object into output route event response
     * @param output Response to add item change event into
     * @param sessionId Session id
     * @param item Item that was adjusted
     */
    protected addItemStackSizeChangeIntoEventResponse(
        output: IItemEventRouterResponse,
        sessionId: string,
        item: Item,
    ): void
    {
        output.profileChanges[sessionId].items.change.push({
            _id: item._id,
            _tpl: item._tpl,
            parentId: item.parentId,
            slotId: item.slotId,
            location: item.location,
            upd: { StackObjectsCount: item.upd.StackObjectsCount },
        });
    }

    /**
     * Get quests, strip all requirement conditions except level
     * @param quests quests to process
     * @returns quest array without conditions
     */
    protected getQuestsWithOnlyLevelRequirementStartCondition(quests: IQuest[]): IQuest[]
    {
        for (const i in quests)
        {
            quests[i] = this.getQuestWithOnlyLevelRequirementStartCondition(quests[i]);
        }

        return quests;
    }

    /**
     * Remove all quest conditions except for level requirement
     * @param quest quest to clean
     * @returns reset IQuest object
     */
    public getQuestWithOnlyLevelRequirementStartCondition(quest: IQuest): IQuest
    {
        quest = this.jsonUtil.clone(quest);
        quest.conditions.AvailableForStart = quest.conditions.AvailableForStart.filter((q) => q._parent === "Level");

        return quest;
    }

    /**
     * Fail a quest in a player profile
     * @param pmcData Player profile
     * @param failRequest Fail quest request data
     * @param sessionID Session id
     * @param output Client output
     * @returns Item event router response
     */
    public failQuest(
        pmcData: IPmcData,
        failRequest: IFailQuestRequestData,
        sessionID: string,
        output: IItemEventRouterResponse = null,
    ): IItemEventRouterResponse
    {
        // Prepare response to send back client
        if (!output)
        {
            output = this.eventOutputHolder.getOutput(sessionID);
        }

        this.updateQuestState(pmcData, QuestStatus.Fail, failRequest.qid);
        const questRewards = this.applyQuestReward(pmcData, failRequest.qid, QuestStatus.Fail, sessionID, output);

        // Create a dialog message for completing the quest.
        const quest = this.getQuestFromDb(failRequest.qid, pmcData);

        this.mailSendService.sendLocalisedNpcMessageToPlayer(
            sessionID,
            this.traderHelper.getTraderById(quest.traderId),
            MessageType.QUEST_FAIL,
            quest.failMessageText,
            questRewards,
            this.timeUtil.getHoursAsSeconds(this.questConfig.redeemTime),
        );

        output.profileChanges[sessionID].quests.push(this.failedUnlocked(failRequest.qid, sessionID));

        return output;
    }

    /**
     * Get List of All Quests from db
     * NOT CLONED
     * @returns Array of IQuest objects
     */
    public getQuestsFromDb(): IQuest[]
    {
        return Object.values(this.databaseServer.getTables().templates.quests);
    }

    /**
     * Get quest by id from database (repeatables are stored in profile, check there if questId not found)
     * @param questId Id of quest to find
     * @param pmcData Player profile
     * @returns IQuest object
     */
    public getQuestFromDb(questId: string, pmcData: IPmcData): IQuest
    {
        let quest = this.databaseServer.getTables().templates.quests[questId];

        // May be a repeatable quest
        if (!quest)
        {
            // Check daily/weekly objects
            for (const repeatableType of pmcData.RepeatableQuests)
            {
                quest = <IQuest><unknown>repeatableType.activeQuests.find((x) => x._id === questId);
                if (quest)
                {
                    break;
                }
            }
        }

        return quest;
    }

    /**
     * Get a quests startedMessageText key from db, if no startedMessageText key found, use description key instead
     * @param startedMessageTextId startedMessageText property from IQuest
     * @param questDescriptionId description property from IQuest
     * @returns message id
     */
    public getMessageIdForQuestStart(startedMessageTextId: string, questDescriptionId: string): string
    {
        // blank or is a guid, use description instead
        const startedMessageText = this.getQuestLocaleIdFromDb(startedMessageTextId);
        if (
            !startedMessageText || startedMessageText.trim() === "" || startedMessageText.toLowerCase() === "test"
            || startedMessageText.length === 24
        )
        {
            return questDescriptionId;
        }

        return startedMessageTextId;
    }

    /**
     * Get the locale Id from locale db for a quest message
     * @param questMessageId Quest message id to look up
     * @returns Locale Id from locale db
     */
    public getQuestLocaleIdFromDb(questMessageId: string): string
    {
        const locale = this.localeService.getLocaleDb();
        return locale[questMessageId];
    }

    /**
     * Alter a quests state + Add a record to its status timers object
     * @param pmcData Profile to update
     * @param newQuestState New state the quest should be in
     * @param questId Id of the quest to alter the status of
     */
    public updateQuestState(pmcData: IPmcData, newQuestState: QuestStatus, questId: string): void
    {
        // Find quest in profile, update status to desired status
        const questToUpdate = pmcData.Quests.find((quest) => quest.qid === questId);
        if (questToUpdate)
        {
            questToUpdate.status = newQuestState;
            questToUpdate.statusTimers[newQuestState] = this.timeUtil.getTimestamp();
        }
    }

    /**
     * Resets a quests values back to its chosen state
     * @param pmcData Profile to update
     * @param newQuestState New state the quest should be in
     * @param questId Id of the quest to alter the status of
     */
    public resetQuestState(pmcData: IPmcData, newQuestState: QuestStatus, questId: string): void
    {
        const questToUpdate = pmcData.Quests.find((quest) => quest.qid === questId);
        if (questToUpdate)
        {
            const currentTimestamp = this.timeUtil.getTimestamp();

            questToUpdate.status = newQuestState;

            // Only set start time when quest is being started
            if (newQuestState === QuestStatus.Started)
            {
                questToUpdate.startTime = currentTimestamp;
            }

            questToUpdate.statusTimers[newQuestState] = currentTimestamp;

            // Delete all status timers after applying new status
            for (const statusKey in questToUpdate.statusTimers)
            {
                if (Number.parseInt(statusKey) > newQuestState)
                {
                    delete questToUpdate.statusTimers[statusKey];
                }
            }

            // Remove all completed conditions
            questToUpdate.completedConditions = [];
        }
    }

    /**
     * Give player quest rewards - Skills/exp/trader standing/items/assort unlocks - Returns reward items player earned
     * @param profileData Player profile (scav or pmc)
     * @param questId questId of quest to get rewards for
     * @param state State of the quest to get rewards for
     * @param sessionId Session id
     * @param questResponse Response to send back to client
     * @returns Array of reward objects
     */
    public applyQuestReward(
        profileData: IPmcData,
        questId: string,
        state: QuestStatus,
        sessionId: string,
        questResponse: IItemEventRouterResponse,
    ): Reward[]
    {
        // Repeatable quest base data is always in PMCProfile, `profileData` may be scav profile
        // TODO: consider moving repeatable quest data to profile-agnostic location
        const pmcProfile = this.profileHelper.getPmcProfile(sessionId);
        let questDetails = this.getQuestFromDb(questId, pmcProfile);
        if (!questDetails)
        {
            this.logger.warning(`Unable to find quest: ${questId} from db, unable to give quest rewards`);

            return [];
        }

        // Check for and apply intel center money bonus if it exists
        const questMoneyRewardBonus = this.getQuestMoneyRewardBonus(pmcProfile);
        if (questMoneyRewardBonus > 0)
        {
            // Apply additional bonus from hideout skill
            questDetails = this.applyMoneyBoost(questDetails, questMoneyRewardBonus, state); // money = money + (money * intelCenterBonus / 100)
        }

        // e.g. 'Success' or 'AvailableForFinish'
        const questStateAsString = QuestStatus[state];
        for (const reward of <Reward[]>questDetails.rewards[questStateAsString])
        {
            switch (reward.type)
            {
                case QuestRewardType.SKILL:
                    this.profileHelper.addSkillPointsToPlayer(
                        profileData,
                        reward.target as SkillTypes,
                        Number(reward.value),
                    );
                    break;
                case QuestRewardType.EXPERIENCE:
                    this.profileHelper.addExperienceToPmc(sessionId, parseInt(<string>reward.value)); // this must occur first as the output object needs to take the modified profile exp value
                    break;
                case QuestRewardType.TRADER_STANDING:
                    this.traderHelper.addStandingToTrader(sessionId, reward.target, parseFloat(<string>reward.value));
                    break;
                case QuestRewardType.TRADER_UNLOCK:
                    this.traderHelper.setTraderUnlockedState(reward.target, true, sessionId);
                    break;
                case QuestRewardType.ITEM:
                    // Handled by getQuestRewardItems() below
                    break;
                case QuestRewardType.ASSORTMENT_UNLOCK:
                    // Handled elsewhere, TODO: find and say here
                    break;
                case QuestRewardType.STASH_ROWS:
                    this.logger.debug("Not implemented stash rows reward yet");
                    break;
                case QuestRewardType.PRODUCTIONS_SCHEME:
                    this.findAndAddHideoutProductionIdToProfile(
                        pmcProfile,
                        reward,
                        questDetails,
                        sessionId,
                        questResponse,
                    );
                    break;
                default:
                    this.logger.error(
                        this.localisationService.getText("quest-reward_type_not_handled", {
                            rewardType: reward.type,
                            questId: questId,
                            questName: questDetails.QuestName,
                        }),
                    );
                    break;
            }
        }

        return this.getQuestRewardItems(questDetails, state);
    }

    /**
     * WIP - Find hideout craft id and add to unlockedProductionRecipe array in player profile
     * also update client response recipeUnlocked array with craft id
     * @param pmcData Player profile
     * @param craftUnlockReward Reward item from quest with craft unlock details
     * @param questDetails Quest with craft unlock reward
     * @param sessionID Session id
     * @param response Response to send back to client
     */
    protected findAndAddHideoutProductionIdToProfile(
        pmcData: IPmcData,
        craftUnlockReward: Reward,
        questDetails: IQuest,
        sessionID: string,
        response: IItemEventRouterResponse,
    ): void
    {
        // Get hideout crafts and find those that match by areatype/required level/end product tpl - hope for just one match
        const hideoutProductions = this.databaseServer.getTables().hideout.production;
        const matchingProductions = hideoutProductions.filter((x) =>
            x.areaType === Number.parseInt(craftUnlockReward.traderId)
            && x.requirements.some((x) => x.requiredLevel === craftUnlockReward.loyaltyLevel)
            && x.endProduct === craftUnlockReward.items[0]._tpl
        );

        // More/less than 1 match, above filtering wasn't strict enough
        if (matchingProductions.length !== 1)
        {
            this.logger.error(
                this.localisationService.getText("quest-unable_to_find_matching_hideout_production", {
                    questName: questDetails.QuestName,
                    matchCount: matchingProductions.length,
                }),
            );

            return;
        }

        // Add above match to pmc profile + client response
        const matchingCraftId = matchingProductions[0]._id;
        pmcData.UnlockedInfo.unlockedProductionRecipe.push(matchingCraftId);
        response.profileChanges[sessionID].recipeUnlocked[matchingCraftId] = true;
    }

    /**
     * Get players money reward bonus from profile
     * @param pmcData player profile
     * @returns bonus as a percent
     */
    protected getQuestMoneyRewardBonus(pmcData: IPmcData): number
    {
        // Check player has intel center
        const moneyRewardBonuses = pmcData.Bonuses.filter((x) => x.type === "QuestMoneyReward");
        if (!moneyRewardBonuses)
        {
            return 0;
        }

        // Get a total of the quest money rewards
        let moneyRewardBonus = moneyRewardBonuses.reduce((acc, cur) => acc + cur.value, 0);

        // Apply hideout management bonus to money reward (up to 51% bonus)
        const hideoutManagementSkill = this.profileHelper.getSkillFromProfile(pmcData, SkillTypes.HIDEOUT_MANAGEMENT);
        if (hideoutManagementSkill)
        {
            moneyRewardBonus *= 1 + (hideoutManagementSkill.Progress / 10000); // 5100 becomes 0.51, add 1 to it, 1.51, multiply the moneyreward bonus by it (e.g. 15 x 51)
        }

        return moneyRewardBonus;
    }

    /**
     * Find quest with 'findItem' condition that needs the item tpl be handed in
     * @param itemTpl item tpl to look for
     * @param questIds Quests to search through for the findItem condition
     * @returns quest id with 'FindItem' condition id
     */
    public getFindItemConditionByQuestItem(
        itemTpl: string,
        questIds: string[],
        allQuests: IQuest[],
    ): Record<string, string>
    {
        const result: Record<string, string> = {};
        for (const questId of questIds)
        {
            const questInDb = allQuests.find((x) => x._id === questId);
            if (!questInDb)
            {
                this.logger.debug(
                    `Unable to find quest: ${questId} in db, cannot get 'FindItem' condition, skipping`,
                );
                continue;
            }

            const condition = questInDb.conditions.AvailableForFinish.find((c) =>
                c._parent === "FindItem" && c._props?.target?.includes(itemTpl)
            );
            if (condition)
            {
                result[questId] = condition._props.id;

                break;
            }
        }

        return result;
    }

    /**
     * Add all quests to a profile with the provided statuses
     * @param pmcProfile profile to update
     * @param statuses statuses quests should have
     */
    public addAllQuestsToProfile(pmcProfile: IPmcData, statuses: QuestStatus[]): void
    {
        // Iterate over all quests in db
        const quests = this.databaseServer.getTables().templates.quests;
        for (const questKey in quests)
        {
            // Quest from db matches quests in profile, skip
            const questData = quests[questKey];
            if (pmcProfile.Quests.find((x) => x.qid === questData._id))
            {
                continue;
            }

            const statusesDict = {};
            for (const status of statuses)
            {
                statusesDict[status] = this.timeUtil.getTimestamp();
            }

            const questRecordToAdd: IQuestStatus = {
                qid: questKey,
                startTime: this.timeUtil.getTimestamp(),
                status: statuses[statuses.length - 1],
                statusTimers: statusesDict,
                completedConditions: [],
                availableAfter: 0,
            };

            if (pmcProfile.Quests.some((x) => x.qid === questKey))
            {
                // Update existing
                const existingQuest = pmcProfile.Quests.find((x) => x.qid === questKey);
                existingQuest.status = questRecordToAdd.status;
                existingQuest.statusTimers = questRecordToAdd.statusTimers;
            }
            else
            {
                // Add new
                pmcProfile.Quests.push(questRecordToAdd);
            }
        }
    }

    public findAndRemoveQuestFromArrayIfExists(questId: string, quests: IQuestStatus[]): void
    {
        const pmcQuestToReplaceStatus = quests.find((x) => x.qid === questId);
        if (pmcQuestToReplaceStatus)
        {
            quests.splice(quests.indexOf(pmcQuestToReplaceStatus, 1));
        }
    }
}
