import test from 'tape';
import { initContext, parseFile, scanParams } from '#';

test('parse interface', t => {
  t.test('ok', q => {
    const file = {
      name: '/home/gerald/com/gerald/one/facade.java',
      content: `
/*
 * Comment block
 */
package com.gerald.one.facade;

import com.gerald.another.facade.BaseRequest;
import com.gerald.another.facade.BaseResponse;
import com.gerald.another.facade.RequestItem;
import com.gerald.another.facade.ResponseItem;

/**
 * one facade
 * @author Gerald
 */
public interface OneFacade {

    /**
     * one method
     */
    BaseResponse<ResponseItem> query(
        RequestItem request,
        BaseRequest<BaseRequest<RequestItem>,
        RequestItem> requestItem);

    /**
     * another method
     */
    boolean done();
}
      `,
    };
    const caseInterface = parseFile(file);
    q.equal(caseInterface.type, 'interface');
    q.equal(caseInterface.payload.methods.length, 2);
    q.equal(caseInterface.payload.methods[0].name, 'query');
    q.deepEqual(caseInterface.payload.methods[1], {
      name: 'done',
      type: {
        name: 'boolean',
        fullName: undefined,
        t: [],
      },
      params: [],
      comment: 'another method',
    });
    q.end();
  });
});

test('parse types', t => {
  t.test('ok', q => {
    const context = initContext({
      name: 'test-file.java',
    });
    const result = scanParams(context, 'Map<String, String > abc, String str');
    q.deepEqual(result, [
      {
        type: {
          name: 'Map',
          fullName: undefined,
          t: [
            {
              name: 'String',
              fullName: undefined,
              t: [],
            },
            {
              name: 'String',
              fullName: undefined,
              t: [],
            },
          ],
        },
        name: 'abc',
      },
      {
        type: {
          name: 'String',
          fullName: undefined,
          t: [],
        },
        name: 'str',
      },
    ]);
    q.end();
  });
});

test('parse enum', t => {
  t.test('ok', q => {
    const file = {
      name: '/home/gerald/com/gerald/one/enum.java',
      content: `
/**
 * hello, world
 */
package com.gerald.model.enums;

/**
 * @author Gerald
 */
public enum SomeEnum {

    /**
     * first item
     */
    FIRST_ITEM("1", "first"),

    /**
     * second item
     */
    SECOND_ITEM("2", "second"),

    ;


    /**
     * code
     */
    private final String code;

    /**
     * desc
     */
    private final String desc;

    SomeEnum(String code, String desc) {
        this.code = code;
        this.desc = desc;
    }
}
      `,
    };
    const caseEnum = parseFile(file);
    q.equal(caseEnum.type, 'enum');
    q.deepEqual(caseEnum.payload.items, [
      {
        name: 'FIRST_ITEM',
        params: ['"1"', '"first"'],
        comment: 'first item',
      },
      {
        name: 'SECOND_ITEM',
        params: ['"2"', '"second"'],
        comment: 'second item',
      },
    ]);
    q.deepEqual(caseEnum.payload.fields, [
      {
        name: 'code',
        type: {
          name: 'String',
          fullName: undefined,
          t: [],
        },
      },
      {
        name: 'desc',
        type: {
          name: 'String',
          fullName: undefined,
          t: [],
        },
      },
    ]);
    q.end();
  });
});

test('parse classes', t => {
  t.test('ok', q => {
    const file = {
      name: '/home/gerald/com/gerald/one/enum.java',
      content: `
/**
 * hello, world
 */
package com.gerald.model.classes;

/**
 * @author Gerald
 */
public class SomeClass<T> {
  T t;
}
`,
    };
    const caseClass = parseFile(file);
    q.deepEqual(caseClass.payload.dep, {
      name: 'SomeClass',
      fullName: 'com.gerald.model.classes.SomeClass',
      t: [
        {
          name: 'T',
          fullName: undefined,
          t: [],
        },
      ],
    });
    q.end();
  });
});
