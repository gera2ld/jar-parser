import test from 'tape';
import { parseFile } from '#/parser';

test('parse interface', t => {
  t.test('ok', q => {
    const caseInterface = parseFile({
      content: `
/*
 * Comment block
 */
package com.gerald.one.facade;

import com.gerald.another.facade.BaseResponse;
import com.gerald.another.facade.ResponseItem;
import com.gerald.another.facade.RequestItem;

/**
 * one facade
 * @author Gerald
 */
public interface OneFacade {

    /**
     * one method
     */
    BaseResponse<ResponseItem> query(RequestItem request);

}
      `,
    });
    q.equal(caseInterface.type, 'interface');
    q.end();
  });
});
