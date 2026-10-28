import {handleApi} from '../../worker/api';
import type {Env} from '../../worker/auth';

export const onRequest:PagesFunction<Env>=({request,env})=>handleApi(request,env);
