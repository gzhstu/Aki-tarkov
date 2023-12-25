import { inject, injectable } from "tsyringe";

import { IGetBodyResponseData } from "@spt-aki/models/eft/httpResponse/IGetBodyResponseData";
import { INullResponseData } from "@spt-aki/models/eft/httpResponse/INullResponseData";
import { IItemEventRouterResponse } from "@spt-aki/models/eft/itemEvent/IItemEventRouterResponse";
import { BackendErrorCodes } from "@spt-aki/models/enums/BackendErrorCodes";
import { LocalisationService } from "@spt-aki/services/LocalisationService";
import { JsonUtil } from "@spt-aki/utils/JsonUtil";

@injectable()
export class HttpResponseUtil
{
    constructor(
        @inject("JsonUtil") protected jsonUtil: JsonUtil,
        @inject("LocalisationService") protected localisationService: LocalisationService,
    )
    {}

    protected clearString(s: string): any
    {
        return s.replace(/[\b]/g, "").replace(/[\f]/g, "").replace(/[\n]/g, "").replace(/[\r]/g, "").replace(
            /[\t]/g,
            "",
        ).replace(/[\\]/g, "");
    }

    /**
     * Return passed in data as JSON string
     * @param data
     * @returns
     */
    public noBody(data: any): any
    {
        return this.clearString(this.jsonUtil.serialize(data));
    }

    /**
     * Game client needs server responses in a particular format
     * @param data
     * @param err
     * @param errmsg
     * @returns
     */
    public getBody<T>(data: T, err = 0, errmsg = null, sanitize = true): IGetBodyResponseData<T>
    {
        return sanitize
            ? this.clearString(this.getUnclearedBody(data, err, errmsg))
            : (this.getUnclearedBody(data, err, errmsg) as any);
    }

    public getUnclearedBody(data: any, err = 0, errmsg = null): string
    {
        return this.jsonUtil.serialize({ err: err, errmsg: errmsg, data: data });
    }

    public emptyResponse(): IGetBodyResponseData<string>
    {
        return this.getBody("", 0, "");
    }

    public nullResponse(): INullResponseData
    {
        return this.clearString(this.getUnclearedBody(null, 0, null));
    }

    public emptyArrayResponse(): IGetBodyResponseData<any[]>
    {
        return this.getBody([]);
    }

    public appendErrorToOutput(
        output: IItemEventRouterResponse,
        message = this.localisationService.getText("http-unknown_error"),
        errorCode = BackendErrorCodes.NONE,
    ): IItemEventRouterResponse
    {
        output.warnings = [{ index: 0, errmsg: message, code: errorCode.toString() }];

        return output;
    }
}
